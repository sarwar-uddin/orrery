"""The QObject that QML talks to: simulated clock + everything derived from it."""

from __future__ import annotations

import json
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from PySide6.QtCore import Property, QObject, QTimer, Signal, Slot

from . import astro

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

COLORS = {
    "Sun": "#ffd27a", "Moon": "#d8d8d0", "Mercury": "#a39e98", "Venus": "#e9d3a4",
    "Earth": "#3f86d9", "Mars": "#c8502a", "Jupiter": "#d9b48c", "Saturn": "#e2cc8f",
    "Uranus": "#9fd8de", "Neptune": "#4f74dd",
}
SIZES = {"Mercury": 4, "Venus": 6.5, "Earth": 7, "Mars": 5, "Jupiter": 12,
         "Saturn": 10, "Uranus": 8, "Neptune": 8}
SKY_BODIES = ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]
NAKED_EYE_LIMIT = 5.0  # Dhaka skies; Uranus (5.6) is a binocular target here


def load_place() -> dict:
    try:
        place = {**DEFAULT_PLACE, **json.loads(CONFIG.read_text())}
        ZoneInfo(place["tz"])
        return place
    except (OSError, ValueError, KeyError):
        return dict(DEFAULT_PLACE)


def _fmt_dur(hours: float) -> str:
    h = int(hours)
    return f"{h}h {round((hours - h) * 60):02d}m"


def compute_almanac(t: datetime, place: dict, tz: ZoneInfo):
    """(sun, moon, tonight) for the local day containing t. Pure; runs off-thread."""
    lat, lon = place["lat"], place["lon"]
    jd = astro.julian_date(t)
    local = t.astimezone(tz)

    def loc(jd_):
        return astro.datetime_from_jd(jd_).astimezone(tz)

    def hm(jd_):
        return loc(jd_).strftime("%H:%M")

    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    day0 = astro.julian_date(midnight)
    day1 = astro.julian_date(midnight + timedelta(days=1))

    # --- sun
    ev = dict((k, v) for k, v in astro.crossings("Sun", day0, day1, lat, lon))
    sun_alt, sun_az = astro.altaz("Sun", jd, lat, lon)
    noon_jd, noon_alt = astro.transit("Sun", day0, day1, lat, lon)
    sun = astro.sun_apparent(jd)
    sun_info = {
        "rise": hm(ev["rise"]) if "rise" in ev else "—",
        "set": hm(ev["set"]) if "set" in ev else "—",
        "noon": f"{hm(noon_jd)} · {noon_alt:.0f}° high",
        "length": _fmt_dur((ev["set"] - ev["rise"]) * 24) if len(ev) == 2 else "—",
        "now": (f"{sun_alt:+.0f}° · {astro.compass(sun_az)}" if sun_alt > -0.8
                else _twilight(sun_alt)),
        "constellation": astro.constellation(sun.lon_j2000),
    }

    # --- moon
    ph = astro.moon_phase(jd)
    m = astro.moon_apparent(jd)
    mev = astro.crossings("Moon", day0, day1, lat, lon)
    nxt = astro.next_phases(jd, 31)
    upcoming = []
    for name in ("Full Moon", "New Moon"):
        hit = next((t for n, t in nxt if n == name), None)
        if hit:
            upcoming.append([name.split()[0], loc(hit).strftime("%a %d %b, %H:%M")])
    moon_alt, moon_az = astro.altaz("Moon", jd, lat, lon)
    moon_info = {
        "name": ph["name"],
        "illumination": ph["illumination"],
        "waxing": ph["waxing"],
        "age": f"{ph['age_days']:.1f} days",
        "distance": f"{ph['dist_km']:,.0f} km",
        "constellation": astro.constellation(m.lon_j2000),
        "rise": next((hm(t) for k, t in mev if k == "rise"), "—"),
        "set": next((hm(t) for k, t in mev if k == "set"), "—"),
        "now": f"{moon_alt:+.0f}° · {astro.compass(moon_az)}",
        "upcoming": upcoming,
    }

    # --- tonight: from the sunset nearest this local afternoon to next morning
    base = local if local.hour >= 12 else local - timedelta(days=1)
    noon = base.replace(hour=12, minute=0, second=0, microsecond=0)
    n0 = astro.julian_date(noon)
    n1 = n0 + 1.0
    steps = 144
    times = [n0 + k / steps for k in range(steps + 1)]
    dark = [astro.altaz("Sun", t, lat, lon)[0] < -6 for t in times]
    rows = []
    for name in SKY_BODIES:
        alts = [astro.altaz(name, t, lat, lon) for t in times]
        mag = (-12.0 if name == "Moon" else astro.planet_magnitude(name, jd))
        good = [i for i in range(len(times)) if dark[i] and alts[i][0] > 8]
        row = {"name": name, "color": COLORS[name],
               "mag": "" if name == "Moon" else f"{mag:+.1f}"}
        now_alt = astro.altaz(name, jd, lat, lon)[0]
        row["up"] = now_alt > 0
        if not good:
            elong = astro.elongation(name, jd)
            row["visible"] = False
            row["text"] = ("lost in the Sun's glare" if elong < 18
                           else "below the horizon all night")
        else:
            best = max(good, key=lambda i: alts[i][0])
            row["visible"] = mag < NAKED_EYE_LIMIT
            when = f"{hm(times[good[0]])}–{hm(times[good[-1]])}"
            row["text"] = (f"{when} · best {hm(times[best])}, "
                           f"{alts[best][0]:.0f}° {astro.compass(alts[best][1])}")
            if not row["visible"]:
                row["text"] += " · binoculars"
        rows.append(row)
    rows.sort(key=lambda r: (not r["visible"], not r["up"]))
    return sun_info, moon_info, rows

def _twilight(alt):
    if alt > -6:
        return f"civil twilight ({alt:.0f}°)"
    if alt > -12:
        return f"nautical twilight ({alt:.0f}°)"
    if alt > -18:
        return f"astronomical twilight ({alt:.0f}°)"
    return f"night ({alt:.0f}°)"


class Sky(QObject):
    clockChanged = Signal()
    bodiesChanged = Signal()
    almanacChanged = Signal()
    selectionChanged = Signal()
    orbitsChanged = Signal()
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

        local = self._t.astimezone(self._tz)
        key = (local.date(), local.hour, local.minute // 10)
        if force_almanac:
            self._almanac_key = key
            self._apply_almanac(compute_almanac(self._t, self._place, self._tz))
        elif key != self._almanac_key:
            self._almanac_key = key
            self._request_almanac()

    # The almanac (rise/set searches, tonight's sky) takes ~70 ms of pure Python,
    # so it runs on a worker thread; while it is busy, newer requests coalesce.
    def _request_almanac(self):
        if self._worker_busy:
            self._worker_dirty = True
            return
        self._worker_busy = True
        t, place, tz = self._t, dict(self._place), self._tz
        threading.Thread(target=self._almanac_job, args=(t, place, tz), daemon=True).start()

    def _almanac_job(self, t, place, tz):
        result = compute_almanac(t, place, tz)
        try:
            self._almanacReady.emit(result)  # queued over to the GUI thread
        except RuntimeError:
            pass  # window closed while we were computing

    def _apply_almanac(self, result):
        self._sun, self._moon, self._tonight = result
        self.almanacChanged.emit()
        if self._worker_busy:
            self._worker_busy = False
            if self._worker_dirty:
                self._worker_dirty = False
                self._request_almanac()

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
            self._sel_info = {}
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

    @Slot(str)
    def select(self, name):
        self._selected = "" if name == self._selected else name
        self._compute_selection(astro.julian_date(self._t))

    @Slot()
    def goLive(self):
        self._live = True
        self._speed = PAUSED
        self._t = datetime.now(timezone.utc)
        self._recompute()

    @Slot()
    def togglePlay(self):
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
