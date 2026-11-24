"""Rise/set, the Moon's day and tonight's sky. Pure Python, no Qt, so it can run
in the worker process (orrery/almanac_worker.py) as well as in the app."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import astro

COLORS = {
    "Sun": "#ffd27a", "Moon": "#d8d8d0", "Mercury": "#a39e98", "Venus": "#e9d3a4",
    "Earth": "#3f86d9", "Mars": "#c8502a", "Jupiter": "#d9b48c", "Saturn": "#e2cc8f",
    "Uranus": "#9fd8de", "Neptune": "#4f74dd",
}
SKY_BODIES = ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]
NAKED_EYE_LIMIT = 5.0  # Dhaka skies; Uranus (5.6) is a binocular target here


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
