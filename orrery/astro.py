"""Small, dependency-free ephemeris.

Planets: JPL "Keplerian Elements for Approximate Positions of the Major
Planets" (E. M. Standish), Table 1, valid 1800-2050 AD. Accuracy is a few
arcminutes for the inner planets and better than ~10' for the outer ones,
which is plenty for an orrery and for "is it up tonight".

Moon: truncated Meeus ch. 47 series (the largest terms), good to roughly
0.1 degree in longitude.

All angles are degrees unless a name says otherwise. Time is the Julian
Date; we ignore the ~69 s TT-UT difference.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

VALID_FROM = datetime(1800, 1, 1, tzinfo=timezone.utc)
VALID_TO = datetime(2050, 12, 31, tzinfo=timezone.utc)

AU_KM = 149_597_870.7
LIGHT_SEC_PER_AU = 499.004784
EARTH_RADIUS_KM = 6378.14

D2R = math.pi / 180.0
R2D = 180.0 / math.pi


def sind(x: float) -> float:
    return math.sin(x * D2R)


def cosd(x: float) -> float:
    return math.cos(x * D2R)


def norm360(x: float) -> float:
    return x % 360.0


def wrap180(x: float) -> float:
    return (x + 180.0) % 360.0 - 180.0


# --------------------------------------------------------------------- time

def julian_date(dt: datetime) -> float:
    """Julian Date of an aware datetime."""
    ts = dt.astimezone(timezone.utc).timestamp()
    return ts / 86400.0 + 2440587.5


def datetime_from_jd(jd: float) -> datetime:
    return datetime.fromtimestamp((jd - 2440587.5) * 86400.0, tz=timezone.utc)


def centuries(jd: float) -> float:
    return (jd - 2451545.0) / 36525.0


def gmst(jd: float) -> float:
    """Greenwich mean sidereal time, degrees (Meeus 12.4)."""
    t = centuries(jd)
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0)
                   + 0.000387933 * t * t - t ** 3 / 38710000.0)


def obliquity(jd: float) -> float:
    return 23.439291 - 0.0130042 * centuries(jd)


# ------------------------------------------------------------------ planets

@dataclass(frozen=True)
class Planet:
    name: str
    # a (AU), e, I, L, long. perihelion, long. ascending node — and rates/century
    el: tuple[float, float, float, float, float, float]
    rate: tuple[float, float, float, float, float, float]
    period_days: float


PLANETS: dict[str, Planet] = {p.name: p for p in (
    Planet("Mercury",
           (0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593),
           (0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081),
           87.969),
    Planet("Venus",
           (0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255),
           (0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418),
           224.701),
    Planet("Earth",  # Earth-Moon barycentre
           (1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0),
           (0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0),
           365.256),
    Planet("Mars",
           (1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891),
           (0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343),
           686.980),
    Planet("Jupiter",
           (5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909),
           (-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106),
           4332.59),
    Planet("Saturn",
           (9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448),
           (-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794),
           10759.22),
    Planet("Uranus",
           (19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503),
           (-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589),
           30688.5),
    Planet("Neptune",
           (30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574),
           (0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664),
           60182.0),
)}

PLANET_ORDER = list(PLANETS)


def _elements(p: Planet, t: float):
    return [x + r * t for x, r in zip(p.el, p.rate)]


def _solve_kepler(m_deg: float, e: float) -> float:
    """Eccentric anomaly (radians) for mean anomaly m (degrees)."""
    m = wrap180(m_deg) * D2R
    big_e = m + e * math.sin(m)
    for _ in range(12):
        d = (big_e - e * math.sin(big_e) - m) / (1.0 - e * math.cos(big_e))
        big_e -= d
        if abs(d) < 1e-12:
            break
    return big_e


def _orbit_to_ecliptic(xp, yp, i, node, argp):
    co, so = cosd(argp), sind(argp)
    cn, sn = cosd(node), sind(node)
    ci, si = cosd(i), sind(i)
    x = (co * cn - so * sn * ci) * xp + (-so * cn - co * sn * ci) * yp
    y = (co * sn + so * cn * ci) * xp + (-so * sn + co * cn * ci) * yp
    z = (so * si) * xp + (co * si) * yp
    return x, y, z


def heliocentric(name: str, jd: float) -> tuple[float, float, float]:
    """Heliocentric ecliptic J2000 rectangular coordinates, AU."""
    a, e, i, mean_l, peri, node = _elements(PLANETS[name], centuries(jd))
    big_e = _solve_kepler(mean_l - peri, e)
    xp = a * (math.cos(big_e) - e)
    yp = a * math.sqrt(1 - e * e) * math.sin(big_e)
    return _orbit_to_ecliptic(xp, yp, i, node, peri - node)


def orbit_path(name: str, jd: float, n: int = 180) -> list[tuple[float, float]]:
    """The osculating ellipse at jd, projected onto the ecliptic plane."""
    a, e, i, _l, peri, node = _elements(PLANETS[name], centuries(jd))
    b = a * math.sqrt(1 - e * e)
    pts = []
    for k in range(n + 1):
        big_e = 2 * math.pi * k / n
        x, y, _ = _orbit_to_ecliptic(a * (math.cos(big_e) - e), b * math.sin(big_e),
                                     i, node, peri - node)
        pts.append((x, y))
    return pts


# ---------------------------------------------------------- coordinate glue

def ecliptic_to_equatorial(lon: float, lat: float, eps: float) -> tuple[float, float]:
    """(lon, lat) -> (ra, dec), degrees."""
    ra = math.atan2(sind(lon) * cosd(eps) - math.tan(lat * D2R) * sind(eps), cosd(lon))
    dec = math.asin(sind(lat) * cosd(eps) + cosd(lat) * sind(eps) * sind(lon))
    return norm360(ra * R2D), dec * R2D


def precession_lon(jd: float) -> float:
    """General precession in longitude since J2000, degrees (J2000 -> of date)."""
    t = centuries(jd)
    return 1.396971 * t + 0.0003086 * t * t


def horizontal(ra: float, dec: float, jd: float, lat: float, lon: float) -> tuple[float, float]:
    """(ra, dec) -> (altitude, azimuth from north through east), degrees."""
    h = gmst(jd) + lon - ra
    alt = math.asin(sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(h))
    az = math.atan2(-cosd(dec) * sind(h),
                    sind(dec) * cosd(lat) - cosd(dec) * sind(lat) * cosd(h))
    return alt * R2D, norm360(az * R2D)


@dataclass
class Apparent:
    lon: float        # geocentric ecliptic longitude, of date
    lat: float
    lon_j2000: float  # for constellation lookup
    ra: float         # of date
    dec: float
    dist_au: float    # from Earth
    r_au: float       # from Sun (0 for the Sun, Earth-Sun for the Moon)


def _apparent_from_vector(gx, gy, gz, jd, r_au) -> Apparent:
    dist = math.sqrt(gx * gx + gy * gy + gz * gz)
    lon0 = norm360(math.atan2(gy, gx) * R2D)
    lat = math.asin(gz / dist) * R2D
    lon = norm360(lon0 + precession_lon(jd))
    ra, dec = ecliptic_to_equatorial(lon, lat, obliquity(jd))
    return Apparent(lon, lat, lon0, ra, dec, dist, r_au)


def planet_apparent(name: str, jd: float) -> Apparent:
    ex, ey, ez = heliocentric("Earth", jd)
    x, y, z = heliocentric(name, jd)
    r = math.sqrt(x * x + y * y + z * z)
    # one light-time iteration: where the planet was when the light left it
    dist = math.dist((x, y, z), (ex, ey, ez))
    x, y, z = heliocentric(name, jd - dist * LIGHT_SEC_PER_AU / 86400.0)
    return _apparent_from_vector(x - ex, y - ey, z - ez, jd, r)


def sun_apparent(jd: float) -> Apparent:
    ex, ey, ez = heliocentric("Earth", jd)
    a = _apparent_from_vector(-ex, -ey, -ez, jd, 0.0)
    a.lon = norm360(a.lon - 20.4898 / 3600.0 / a.dist_au)  # aberration
    a.ra, a.dec = ecliptic_to_equatorial(a.lon, a.lat, obliquity(jd))
    return a


# --------------------------------------------------------------------- moon

# (D, M, M', F, coefficient) — Meeus table 47.A (longitude, 1e-6 deg / distance, 1e-3 km)
_MOON_LR = [
    (0, 0, 1, 0, 6288774, -20905355), (2, 0, -1, 0, 1274027, -3699111),
    (2, 0, 0, 0, 658314, -2955968), (0, 0, 2, 0, 213618, -569925),
    (0, 1, 0, 0, -185116, 48888), (0, 0, 0, 2, -114332, -3149),
    (2, 0, -2, 0, 58793, 246158), (2, -1, -1, 0, 57066, -152138),
    (2, 0, 1, 0, 53322, -170733), (2, -1, 0, 0, 45758, -204586),
    (0, 1, -1, 0, -40923, -129620), (1, 0, 0, 0, -34720, 108743),
    (0, 1, 1, 0, -30383, 104755), (2, 0, 0, -2, 15327, 10321),
    (0, 0, 1, 2, -12528, 0), (0, 0, 1, -2, 10980, 79661),
    (4, 0, -1, 0, 10675, -34782), (0, 0, 3, 0, 10034, -23210),
    (4, 0, -2, 0, 8548, -21636), (2, 1, -1, 0, -7888, 24208),
    (2, 1, 0, 0, -6766, 30824), (1, 0, -1, 0, -5163, -8379),
    (1, 1, 0, 0, 4987, -16675), (2, -1, 1, 0, 4036, -12831),
    (2, 0, 2, 0, 3994, -10445), (4, 0, 0, 0, 3861, -11650),
    (2, 0, -3, 0, 3665, 14403), (0, 1, -2, 0, -2689, -7003),
    (2, 0, -1, 2, -2602, 0), (2, -1, -2, 0, 2390, 10056),
    (1, 0, 1, 0, -2348, 6322), (2, -2, 0, 0, 2236, -9884),
]
# Meeus table 47.B (latitude, 1e-6 deg)
_MOON_B = [
    (0, 0, 0, 1, 5128122), (0, 0, 1, 1, 280602), (0, 0, 1, -1, 277693),
    (2, 0, 0, -1, 173237), (2, 0, -1, 1, 55413), (2, 0, -1, -1, 46271),
    (2, 0, 0, 1, 32573), (0, 0, 2, 1, 17198), (2, 0, 1, -1, 9266),
    (0, 0, 2, -1, 8822), (2, -1, 0, -1, 8216), (2, 0, -2, -1, 4324),
    (2, 0, 1, 1, 4200), (2, 1, 0, -1, -3359), (2, -1, -1, 1, 2463),
    (2, -1, 0, 1, 2211), (2, -1, -1, -1, 2065), (0, 1, -1, -1, -1870),
    (4, 0, -1, -1, 1828), (0, 1, 0, 1, -1794),
]


def moon_apparent(jd: float) -> Apparent:
    t = centuries(jd)
    lp = norm360(218.3164477 + 481267.88123421 * t - 0.0015786 * t * t)
    d = norm360(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t)
    m = norm360(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t)
    mp = norm360(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t)
    f = norm360(93.2720950 + 483202.0175233 * t - 0.0036539 * t * t)
    a1 = norm360(119.75 + 131.849 * t)
    a2 = norm360(53.09 + 479264.290 * t)
    a3 = norm360(313.45 + 481266.484 * t)
    ecc = 1 - 0.002516 * t - 0.0000074 * t * t

    sl = sr = sb = 0.0
    for cd, cm, cmp, cf, l_coef, r_coef in _MOON_LR:
        arg = cd * d + cm * m + cmp * mp + cf * f
        k = ecc ** abs(cm)
        sl += l_coef * k * sind(arg)
        sr += r_coef * k * cosd(arg)
    for cd, cm, cmp, cf, b_coef in _MOON_B:
        sb += b_coef * ecc ** abs(cm) * sind(cd * d + cm * m + cmp * mp + cf * f)
    sl += 3958 * sind(a1) + 1962 * sind(lp - f) + 318 * sind(a2)
    sb += (-2235 * sind(lp) + 382 * sind(a3) + 175 * sind(a1 - f)
           + 175 * sind(a1 + f) + 127 * sind(lp - mp) - 115 * sind(lp + mp))

    lon = norm360(lp + sl / 1e6)
    lat = sb / 1e6
    dist_km = 385000.56 + sr / 1000.0
    ra, dec = ecliptic_to_equatorial(lon, lat, obliquity(jd))
    return Apparent(lon, lat, norm360(lon - precession_lon(jd)), ra, dec,
                    dist_km / AU_KM, 1.0)


def moon_phase(jd: float) -> dict:
    """Illumination and phase details for the Moon at jd."""
    moon, sun = moon_apparent(jd), sun_apparent(jd)
    elong_lon = norm360(moon.lon - sun.lon)          # 0 new, 180 full
    psi = math.acos(cosd(moon.lat) * cosd(moon.lon - sun.lon))
    sun_km, moon_km = sun.dist_au * AU_KM, moon.dist_au * AU_KM
    phase_angle = math.atan2(sun_km * math.sin(psi), moon_km - sun_km * math.cos(psi))
    illum = (1 + math.cos(phase_angle)) / 2
    return {
        "elongation": elong_lon,
        "illumination": illum,
        "waxing": elong_lon < 180.0,
        "name": phase_name(elong_lon),
        "age_days": elong_lon / 360.0 * 29.530589,
        "dist_km": moon_km,
    }


def phase_name(elong: float) -> str:
    names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
             "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"]
    # the four principal phases get a narrow ±7° window, the rest is the in-between
    for idx, centre in enumerate((0, 90, 180, 270)):
        if abs(wrap180(elong - centre)) < 7:
            return names[idx * 2]
    return names[int(elong // 90) * 2 + 1]


def next_phases(jd: float, days: float = 31.0) -> list[tuple[str, float]]:
    """[(name, jd)] of principal phases in (jd, jd+days], in time order."""
    targets = {0: "New Moon", 90: "First Quarter", 180: "Full Moon", 270: "Last Quarter"}

    def elong(t):
        return norm360(moon_apparent(t).lon - sun_apparent(t).lon)

    out = []
    step = 0.5
    t0, e0 = jd, elong(jd)
    while t0 < jd + days:
        t1 = t0 + step
        e1 = elong(t1)
        for target, name in targets.items():
            a, b = wrap180(e0 - target), wrap180(e1 - target)
            if a < 0 <= b and b - a < 30:   # crossed upward (the Moon gains ~6°/half-day)
                lo, hi = t0, t1
                for _ in range(40):
                    mid = (lo + hi) / 2
                    if wrap180(elong(mid) - target) < 0:
                        lo = mid
                    else:
                        hi = mid
                out.append((name, (lo + hi) / 2))
        t0, e0 = t1, e1
    return out


# --------------------------------------------------------- the local sky

def body_apparent(name: str, jd: float) -> Apparent:
    if name == "Sun":
        return sun_apparent(jd)
    if name == "Moon":
        return moon_apparent(jd)
    return planet_apparent(name, jd)


def altaz(name: str, jd: float, lat: float, lon: float) -> tuple[float, float]:
    a = body_apparent(name, jd)
    alt, az = horizontal(a.ra, a.dec, jd, lat, lon)
    if name == "Moon":  # topocentric parallax (~1°): big enough to matter
        alt -= math.asin(EARTH_RADIUS_KM / (a.dist_au * AU_KM)) * R2D * cosd(alt)
    return alt, az


# standard altitudes for rise/set: refraction + semidiameter
H0 = {"Sun": -0.833, "Moon": -0.583}  # moon: topocentric alt is used, so like a big star
H0_STAR = -0.567


def crossings(name: str, jd0: float, jd1: float, lat: float, lon: float,
              step_min: float = 10.0) -> list[tuple[str, float]]:
    """Rise/set events [("rise"|"set", jd)] between jd0 and jd1."""
    h0 = H0.get(name, H0_STAR)
    step = step_min / 1440.0
    events = []
    t0 = jd0
    f0 = altaz(name, t0, lat, lon)[0] - h0
    while t0 < jd1:
        t1 = min(t0 + step, jd1)
        f1 = altaz(name, t1, lat, lon)[0] - h0
        if (f0 < 0) != (f1 < 0):
            lo, hi, flo = t0, t1, f0
            for _ in range(20):
                mid = (lo + hi) / 2
                fm = altaz(name, mid, lat, lon)[0] - h0
                if (fm < 0) == (flo < 0):
                    lo, flo = mid, fm
                else:
                    hi = mid
            events.append(("rise" if f0 < 0 else "set", (lo + hi) / 2))
        t0, f0 = t1, f1
    return events


def transit(name: str, jd0: float, jd1: float, lat: float, lon: float) -> tuple[float, float]:
    """(jd, altitude) of the highest point between jd0 and jd1 (coarse + golden refine)."""
    best_t, best_alt = jd0, -90.0
    n = int((jd1 - jd0) * 144) + 1
    for k in range(n + 1):
        t = jd0 + (jd1 - jd0) * k / n
        alt = altaz(name, t, lat, lon)[0]
        if alt > best_alt:
            best_t, best_alt = t, alt
    lo, hi = best_t - 0.01, best_t + 0.01
    for _ in range(30):
        m1, m2 = lo + (hi - lo) * 0.382, lo + (hi - lo) * 0.618
        if altaz(name, m1, lat, lon)[0] > altaz(name, m2, lat, lon)[0]:
            hi = m2
        else:
            lo = m1
    t = (lo + hi) / 2
    return t, altaz(name, t, lat, lon)[0]


# ---------------------------------------------------- brightness & places

def planet_magnitude(name: str, jd: float) -> float:
    """Visual magnitude (Meeus 41, 'Astronomical Almanac' style formulas)."""
    a = planet_apparent(name, jd)
    sun = sun_apparent(jd)
    r, delta, big_r = a.r_au, a.dist_au, sun.dist_au
    cos_i = (r * r + delta * delta - big_r * big_r) / (2 * r * delta)
    i = math.acos(max(-1.0, min(1.0, cos_i))) * R2D
    base = 5 * math.log10(r * delta)
    if name == "Mercury":
        return -0.42 + base + 0.0380 * i - 0.000273 * i ** 2 + 0.000002 * i ** 3
    if name == "Venus":
        return -4.40 + base + 0.0009 * i + 0.000239 * i ** 2 - 0.00000065 * i ** 3
    if name == "Mars":
        return -1.52 + base + 0.016 * i
    if name == "Jupiter":
        return -9.40 + base + 0.005 * i
    if name == "Saturn":
        return -8.88 + base + 0.044 * i  # ring tilt ignored
    if name == "Uranus":
        return -7.19 + base
    return -6.87 + base


def elongation(name: str, jd: float) -> float:
    """Angular distance from the Sun as seen from Earth."""
    a, s = body_apparent(name, jd), sun_apparent(jd)
    c = sind(a.dec) * sind(s.dec) + cosd(a.dec) * cosd(s.dec) * cosd(a.ra - s.ra)
    return math.acos(max(-1.0, min(1.0, c))) * R2D


# Where the ecliptic crosses the IAU constellation boundaries (J2000 longitude).
# Exact for bodies on the ecliptic; the Moon (±5°) and Pluto-like inclinations
# can occasionally sit in a neighbour (Orion, Cetus, Sextans...).
_ZODIAC = [
    (28.69, "Pisces"), (53.42, "Aries"), (90.14, "Taurus"), (117.99, "Gemini"),
    (138.01, "Cancer"), (173.86, "Leo"), (217.81, "Virgo"), (241.03, "Libra"),
    (248.04, "Scorpius"), (266.28, "Ophiuchus"), (299.73, "Sagittarius"),
    (327.48, "Capricornus"), (351.57, "Aquarius"), (360.01, "Pisces"),
]
ZODIAC_BOUNDARIES = [b for b, _ in _ZODIAC[:-1]]


def constellation(lon_j2000: float) -> str:
    lon = norm360(lon_j2000)
    for upper, name in _ZODIAC:
        if lon < upper:
            return name
    return "Pisces"


def zodiac_labels() -> list[tuple[str, float]]:
    """(name, mid-longitude) for drawing the ring."""
    out = []
    prev = _ZODIAC[-2][0] - 360.0
    for upper, name in _ZODIAC[:-1]:
        out.append((name, norm360((prev + upper) / 2)))
        prev = upper
    return out


COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def compass(az: float) -> str:
    return COMPASS[int((norm360(az) + 11.25) // 22.5) % 16]
