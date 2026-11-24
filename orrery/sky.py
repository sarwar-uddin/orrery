"""The QObject that QML talks to: simulated clock + everything derived from it."""

from __future__ import annotations

import json
import math
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from PySide6.QtCore import Property, QObject, QProcess, QProcessEnvironment, QTimer, Signal, Slot

from . import astro
from .almanac import COLORS, compute_almanac

CONFIG = Path.home() / ".config" / "orrery" / "config.json"
DEFAULT_PLACE = {"name": "Dhaka", "lat": 23.8103, "lon": 90.4125, "tz": "Asia/Dhaka"}

# simulated seconds per real second; index 0 is the middle (paused)
SPEEDS = [
    (-31_557_600, "−1 yr/s"), (-2_629_800, "−1 mo/s"), (-604_800, "−1 wk/s"),
    (-86_400, "−1 day/s"), (-3_600, "−1 hr/s"), (-60, "−1 min/s"),
    (0, "paused"),
    (1, "real time"), (60, "1 min/s"), (3_600, "1 hr/s"), (86_400, "1 day/s"),
    (604_800, "1 wk/s"), (2_629_800, "1 mo/s"), (31_557_600, "1 yr/s"),
]
PAUSED = 6
REALTIME = 7

SIZES = {"Mercury": 4, "Venus": 6.5, "Earth": 7, "Mars": 5, "Jupiter": 12,
         "Saturn": 10, "Uranus": 8, "Neptune": 8}


def load_place() -> dict:
    try:
        place = {**DEFAULT_PLACE, **json.loads(CONFIG.read_text())}
        ZoneInfo(place["tz"])
        return place
    except (OSError, ValueError, KeyError):
        return dict(DEFAULT_PLACE)


class Sky(QObject):
    clockChanged = Signal()
    bodiesChanged = Signal()
    almanacChanged = Signal()
    selectionChanged = Signal()
    orbitsChanged = Signal()
    sceneChanged = Signal()       # anything the 3D view draws
    _almanacReady = Signal(object)

    def __init__(self):
        super().__init__()
        self._place = load_place()
        self._tz = ZoneInfo(self._place["tz"])
        self._t = datetime.now(timezone.utc)
        self._live = True
        self._speed = PAUSED
        self._selected = ""
        self._bodies: list = []
        self._orbits: list = []
        self._orbit_jd = None
        self._moon: dict = {}
        self._sun: dict = {}
        self._tonight: list = []
        self._sel_info: dict = {}
        self._almanac_key = None

        self._last_tick = time.monotonic()
        self._tick = QTimer(self, interval=33, timeout=self._on_tick)
        self._tick.start()
        self._worker_busy = False
        self._worker_dirty = False
        self._proc = None          # the almanac worker (QProcess); False = unavailable
        self._proc_buf = b""
        self._almanacReady.connect(self._apply_almanac)
        self._recompute(force_almanac=True)

    # ------------------------------------------------------------ clock
    def _on_tick(self):
        now = time.monotonic()
        dt_real, self._last_tick = now - self._last_tick, now
        if self._live:
            new = datetime.now(timezone.utc)
            if int(new.timestamp()) == int(self._t.timestamp()):
                return  # only repaint once a second when live
            self._t = new
        elif self._speed != PAUSED:
            self._set_time(self._t + timedelta(seconds=SPEEDS[self._speed][0] * dt_real),
                           keep_speed=True)
            return
        else:
            return
        self._recompute()

    def _set_time(self, t: datetime, keep_speed=False):
        if t < astro.VALID_FROM or t > astro.VALID_TO:
            t = min(max(t, astro.VALID_FROM), astro.VALID_TO)
            self._speed = PAUSED
        self._t = t
        self._live = False
        if not keep_speed:
            self._speed = PAUSED
        self._recompute()

    def _recompute(self, force_almanac=False):
        jd = astro.julian_date(self._t)
        self._compute_bodies(jd)
        if self._orbit_jd is None or abs(jd - self._orbit_jd) > 3650:
            self._orbit_jd = jd
            self._orbits = [{"name": n, "points": [[x, y] for x, y in astro.orbit_path(n, jd)]}
                            for n in astro.PLANET_ORDER]
            self.orbitsChanged.emit()
        self._compute_selection(jd)
        self.clockChanged.emit()
        self.bodiesChanged.emit()
        self.sceneChanged.emit()

        local = self._t.astimezone(self._tz)
        key = (local.date(), local.hour, local.minute // 10)
        if force_almanac:
            self._almanac_key = key
            self._apply_almanac(compute_almanac(self._t, self._place, self._tz))
        elif key != self._almanac_key:
            self._almanac_key = key
            self._request_almanac()

    # The almanac (rise/set searches, tonight's sky) is ~100 ms of pure Python.
    # It runs in a worker *process* (orrery/almanac_worker.py, over a pipe): on
    # a thread it would hold the GIL and starve the GUI thread, which is what
    # feeds frames to the 3D view. While a job is out, newer requests coalesce
    # into one; during playback they are also spaced out, since nobody can read
    # rise/set times changing 30 times a second.
    ALMANAC_PLAYBACK_GAP_MS = 300

    def _request_almanac(self):
        if self._worker_busy:
            self._worker_dirty = True
            return
        self._worker_busy = True
        self._pending = (self._t, dict(self._place), self._tz)
        proc = self._worker()
        if proc:
            req = {"t": self._t.timestamp(), "place": self._place}
            proc.write((json.dumps(req) + "\n").encode())
        else:  # no subprocesses here: a thread will do, GIL and all
            threading.Thread(target=self._almanac_thread, args=self._pending, daemon=True).start()

    def _worker(self):
        if self._proc is None:
            proc = QProcess(self)
            env = QProcessEnvironment.systemEnvironment()
            root = str(Path(__file__).resolve().parent.parent)
            old = env.value("PYTHONPATH")
            env.insert("PYTHONPATH", root + (":" + old if old else ""))
            proc.setProcessEnvironment(env)
            proc.setProcessChannelMode(QProcess.ProcessChannelMode.ForwardedErrorChannel)
            proc.readyReadStandardOutput.connect(self._worker_output)
            proc.errorOccurred.connect(self._worker_failed)
            proc.start(sys.executable, ["-m", "orrery.almanac_worker"])
            self._proc = proc
        return self._proc

    def _worker_output(self):
        if not self._proc:
            return  # shutting down
        self._proc_buf += bytes(self._proc.readAllStandardOutput())
        while b"\n" in self._proc_buf:
            line, self._proc_buf = self._proc_buf.split(b"\n", 1)
            try:
                reply = json.loads(line)
                if isinstance(reply, dict):
                    raise ValueError(reply.get("error"))
                result = tuple(reply)
            except ValueError:
                result = compute_almanac(*self._pending)
            self._apply_almanac(result)

    def _worker_failed(self, _err):
        # couldn't start, or crashed: go in-process from now on, and don't
        # leave the request that was in flight hanging
        if self._proc is False:
            return
        self._proc = False
        if self._worker_busy:
            threading.Thread(target=self._almanac_thread, args=self._pending, daemon=True).start()

    def _almanac_thread(self, *args):
        self._emit_almanac(compute_almanac(*args))

    def _emit_almanac(self, result):
        try:
            self._almanacReady.emit(result)  # queued over to the GUI thread
        except RuntimeError:
            pass  # window closed while we were computing

    def _apply_almanac(self, result):
        self._sun, self._moon, self._tonight = result
        self.almanacChanged.emit()
        if not self._worker_busy:
            return
        if not self._worker_dirty:
            self._worker_busy = False
        elif self.playing:
            # stay "busy" through a cooldown, then catch up with wherever the clock is
            QTimer.singleShot(self.ALMANAC_PLAYBACK_GAP_MS, self._after_cooldown)
        else:
            self._worker_busy = self._worker_dirty = False
            self._request_almanac()

    def _after_cooldown(self):
        if not self._tick.isActive():
            return  # shut down meanwhile
        self._worker_busy = self._worker_dirty = False
        self._request_almanac()

    def shutdown(self):
        """Stop the clock and the worker process (call before the app exits)."""
        self._tick.stop()
        proc, self._proc = self._proc, False
        if proc:
            proc.errorOccurred.disconnect(self._worker_failed)
            proc.readyReadStandardOutput.disconnect(self._worker_output)
            proc.closeWriteChannel()          # EOF: the worker's loop ends
            if not proc.waitForFinished(1000):
                proc.kill()
                proc.waitForFinished(500)

    # ------------------------------------------------------- positions
    def _compute_bodies(self, jd):
        lat, lon = self._place["lat"], self._place["lon"]
        sun_alt, _ = astro.altaz("Sun", jd, lat, lon)
        moon = astro.moon_apparent(jd)
        out = []
        for name in astro.PLANET_ORDER:
            x, y, z = astro.heliocentric(name, jd)
            body = {"name": name, "x": x, "y": y, "r": math.hypot(x, y, z),
                    "color": COLORS[name], "size": SIZES[name]}
            if name == "Earth":
                body["moonLon"] = moon.lon_j2000
            else:
                alt, az = astro.altaz(name, jd, lat, lon)
                body.update(alt=alt, az=az)
            out.append(body)
        self._bodies = out
        self._sun_alt = sun_alt

    def _compute_selection(self, jd):
        name = self._selected
        if not name:
            if self._sel_info:          # only on the way out: an unchanged {} would
                self._sel_info = {}     # still rebuild the sidebar card every tick
                self.selectionChanged.emit()
            return
        lat, lon = self._place["lat"], self._place["lon"]
        info = {"name": name, "color": COLORS[name]}
        if name == "Earth":
            x, y, z = astro.heliocentric("Earth", jd)
            r = math.hypot(x, y, z)
            info.update(
                subtitle="You are here",
                rows=[["From the Sun", f"{r:.4f} AU"],
                      ["", f"{r * astro.AU_KM / 1e6:.2f} million km"],
                      ["Sunlight age", f"{r * astro.LIGHT_SEC_PER_AU / 60:.2f} min"],
                      ["Year", "365.256 days"]])
        else:
            a = astro.planet_apparent(name, jd)
            alt, az = astro.altaz(name, jd, lat, lon)
            lt = a.dist_au * astro.LIGHT_SEC_PER_AU
            lt_txt = f"{lt / 60:.1f} min" if lt < 3600 else f"{lt / 3600:.2f} h"
            per = astro.PLANETS[name].period_days
            per_txt = f"{per:.0f} days" if per < 1000 else f"{per / 365.25:.1f} years"
            ra_h = a.ra / 15
            info.update(
                subtitle=f"in {astro.constellation(a.lon_j2000)}",
                rows=[["From Earth", f"{a.dist_au:.3f} AU"],
                      ["", f"{a.dist_au * astro.AU_KM / 1e6:,.0f} million km"],
                      ["Light time", lt_txt],
                      ["From the Sun", f"{a.r_au:.3f} AU"],
                      ["Magnitude", f"{astro.planet_magnitude(name, jd):+.1f}"],
                      ["Sun distance", f"{astro.elongation(name, jd):.0f}° away in the sky"],
                      ["RA / Dec", f"{int(ra_h)}h {int(ra_h % 1 * 60):02d}m / {a.dec:+.1f}°"],
                      ["Alt / Az", f"{alt:+.0f}° · {astro.compass(az)} ({az:.0f}°)"],
                      ["Orbit", per_txt]])
        if info != self._sel_info:
            self._sel_info = info
            self.selectionChanged.emit()

    # ---------------------------------------------------- QML interface
    @Property(str, notify=clockChanged)
    def timeText(self):
        return self._t.astimezone(self._tz).strftime("%H:%M:%S")

    @Property(str, notify=clockChanged)
    def dateText(self):
        return self._t.astimezone(self._tz).strftime("%A, %d %B %Y")

    @Property(str, notify=clockChanged)
    def utcText(self):
        return f"UTC {self._t:%H:%M} · {self._place['name']} · JD {astro.julian_date(self._t):.3f}"

    @Property(bool, notify=clockChanged)
    def live(self):
        return self._live

    @Property(bool, notify=clockChanged)
    def playing(self):
        return self._speed != PAUSED and not self._live

    @Property(str, notify=clockChanged)
    def speedText(self):
        return "live" if self._live else SPEEDS[self._speed][1]

    @Property(float, notify=clockChanged)
    def sunAltitude(self):
        return self._sun_alt

    @Property("QVariantList", notify=bodiesChanged)
    def bodies(self):
        return self._bodies

    @Property("QVariantList", notify=orbitsChanged)
    def orbits(self):
        return self._orbits

    @Property("QVariantList", constant=True)
    def zodiac(self):
        return [{"name": n, "lon": lon} for n, lon in astro.zodiac_labels()]

    @Property("QVariantList", constant=True)
    def zodiacBoundaries(self):
        return astro.ZODIAC_BOUNDARIES

    @Property("QVariantMap", notify=almanacChanged)
    def moon(self):
        return self._moon

    @Property("QVariantMap", notify=almanacChanged)
    def sun(self):
        return self._sun

    @Property("QVariantList", notify=almanacChanged)
    def tonight(self):
        return self._tonight

    @Property(str, constant=True)
    def placeName(self):
        return self._place["name"]

    @Property(str, notify=selectionChanged)
    def selected(self):
        return self._selected

    @Property("QVariantMap", notify=selectionChanged)
    def selectedInfo(self):
        return self._sel_info

    # --- the 3D view: plain JSON, handed to the page with runJavaScript.
    # Computed only when read, so the 2D map pays nothing for it.
    @Property(str, notify=sceneChanged)
    def scene3d(self):
        jd = astro.julian_date(self._t)
        bodies = []
        for b in self._bodies:
            pole, pm = astro.body_axes(b["name"], jd)
            bodies.append({"name": b["name"], "pos": astro.heliocentric(b["name"], jd),
                           "pole": pole, "pm": pm, "up": b.get("alt", -1) > 0})
        sun_pole, sun_pm = astro.body_axes("Sun", jd)
        return json.dumps({
            "jd": jd, "days": jd - astro.J2000,
            "speed": 1 if self._live else SPEEDS[self._speed][0],
            "live": self._live,
            "selected": self._selected,
            "place": {"name": self._place["name"], "lat": self._place["lat"], "lon": self._place["lon"]},
            "bodies": bodies,
            "sun": {"pole": sun_pole, "pm": sun_pm},
            "moon": astro.moon_geocentric(jd),
        })

    @Property(str, notify=orbitsChanged)
    def orbits3d(self):
        jd = self._orbit_jd if self._orbit_jd is not None else astro.julian_date(self._t)
        return json.dumps([{"name": n, "points": [[round(c, 6) for c in p] for p in astro.orbit_path_3d(n, jd)]}
                           for n in astro.PLANET_ORDER])

    @Property(str, constant=True)
    def static3d(self):
        return json.dumps({"zodiac": [{"name": n, "lon": lon} for n, lon in astro.zodiac_labels()],
                           "boundaries": astro.ZODIAC_BOUNDARIES})

    @Slot(str)
    def select(self, name):
        self._selected = "" if name == self._selected else name
        self._compute_selection(astro.julian_date(self._t))
        self.sceneChanged.emit()

    @Slot()
    def goLive(self):
        self._live = True
        self._speed = PAUSED
        self._t = datetime.now(timezone.utc)
        self._recompute()

    @Slot()
    def togglePlay(self):
        self._toggle_play()
        self.sceneChanged.emit()    # the 3D view gates its globes' spin on the speed

    def _toggle_play(self):
        if self._live:
            self._live = False
            self._speed = SPEEDS.index((86_400, "1 day/s"))
        elif self._speed == PAUSED:
            self._speed = SPEEDS.index((86_400, "1 day/s"))
        else:
            self._speed = PAUSED
        self.clockChanged.emit()

    @Slot(int)
    def nudgeSpeed(self, direction):
        """Faster forward (+1) or faster backward (−1), passing through pause."""
        if self._live:
            self._live = False
            self._speed = REALTIME
        self._speed = max(0, min(len(SPEEDS) - 1, self._speed + direction))
        self.clockChanged.emit()
        self.sceneChanged.emit()

    @Slot(float)
    def step(self, seconds):
        self._set_time(self._t + timedelta(seconds=seconds), keep_speed=True)

    @Slot(int, int, int)
    def jumpToDate(self, year, month, day):
        local = self._t.astimezone(self._tz)
        try:
            target = local.replace(year=year, month=month, day=day)
        except ValueError:
            return
        self._set_time(target.astimezone(timezone.utc))
