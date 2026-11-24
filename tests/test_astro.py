"""Checks against JPL DE421 (computed once with skyfield; values pinned here so
the tests need nothing but the standard library)."""

import math
import unittest
from datetime import datetime, timezone

from orrery import astro

DHAKA = (23.8103, 90.4125)


def jd(*args):
    return astro.julian_date(datetime(*args, tzinfo=timezone.utc))


def utc(j):
    return astro.datetime_from_jd(j)


class RiseSet(unittest.TestCase):
    # DE421 / skyfield almanac, Dhaka, 2026-11-22 (times UTC)
    REF = {
        "Sun": [("rise", datetime(2026, 11, 22, 0, 17, 34)), ("set", datetime(2026, 11, 22, 11, 11, 2))],
        "Moon": [("rise", datetime(2026, 11, 22, 9, 9, 24)), ("set", datetime(2026, 11, 22, 22, 36, 34))],
        "Jupiter": [("set", datetime(2026, 11, 22, 6, 15, 29)), ("rise", datetime(2026, 11, 22, 17, 20, 10))],
        "Venus": [("set", datetime(2026, 11, 22, 9, 8, 31)), ("rise", datetime(2026, 11, 22, 21, 35, 22))],
    }

    def test_within_a_minute(self):
        j0 = jd(2026, 11, 22)
        for name, events in self.REF.items():
            got = astro.crossings(name, j0, j0 + 1, *DHAKA)
            for kind, when in events:
                when = when.replace(tzinfo=timezone.utc)
                match = [utc(t) for k, t in got if k == kind]
                self.assertTrue(match, f"{name} {kind} missing")
                err = min(abs((m - when).total_seconds()) for m in match)
                self.assertLess(err, 60, f"{name} {kind} off by {err:.0f}s")


class Phases(unittest.TestCase):
    REF = [
        ("Last Quarter", datetime(2026, 11, 1, 20, 28)), ("New Moon", datetime(2026, 11, 9, 7, 2)),
        ("First Quarter", datetime(2026, 11, 17, 11, 47)), ("Full Moon", datetime(2026, 11, 24, 14, 53)),
        ("Last Quarter", datetime(2026, 12, 1, 6, 8)), ("New Moon", datetime(2026, 12, 9, 0, 51)),
    ]

    def test_principal_phases(self):
        got = astro.next_phases(jd(2026, 11, 1), 40)
        self.assertEqual([n for n, _ in got[:6]], [n for n, _ in self.REF])
        for (_, t), (_, ref) in zip(got, self.REF):
            err = abs((utc(t) - ref.replace(tzinfo=timezone.utc)).total_seconds())
            self.assertLess(err, 5 * 60)


class Positions(unittest.TestCase):
    def test_geocentric_distances_sane(self):
        j = jd(2026, 11, 22)
        for name in astro.PLANET_ORDER:
            if name == "Earth":
                continue
            a = astro.planet_apparent(name, j)
            semi = astro.PLANETS[name].el[0]
            self.assertTrue(abs(semi - 1) * 0.9 < a.dist_au < (semi + 1) * 1.1, name)

    def test_constellations(self):
        self.assertEqual(astro.constellation(0), "Pisces")
        self.assertEqual(astro.constellation(250), "Ophiuchus")
        self.assertEqual(astro.constellation(359), "Pisces")
        self.assertEqual(len(astro.zodiac_labels()), 13)

    def test_phase_names(self):
        self.assertEqual(astro.phase_name(2), "New Moon")
        self.assertEqual(astro.phase_name(45), "Waxing Crescent")
        self.assertEqual(astro.phase_name(181), "Full Moon")
        self.assertEqual(astro.phase_name(300), "Waning Crescent")


def _unit(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _angle(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, _dot(_unit(a), _unit(b))))))


class Orientation(unittest.TestCase):
    """The IAU rotation models, checked against things that are independently known."""

    def test_earth_obliquity(self):
        pole, _ = astro.body_axes("Earth", jd(2026, 11, 22))
        self.assertAlmostEqual(_angle(pole, (0, 0, 1)), 23.44, delta=0.02)

    def test_axes_orthonormal(self):
        for name in astro.IAU_ROTATION:
            pole, pm = astro.body_axes(name, jd(2031, 5, 17, 6))
            self.assertAlmostEqual(_dot(pole, pole), 1, places=9)
            self.assertAlmostEqual(_dot(pm, pm), 1, places=9)
            self.assertAlmostEqual(_dot(pole, pm), 0, places=9)

    def test_obliquities_to_orbit(self):
        # axial tilt relative to each planet's own orbit (NASA fact sheets)
        # (right-hand rule, so Venus and Uranus come out past 90)
        tilt = {"Mercury": 0.03, "Venus": 177.4, "Earth": 23.44, "Mars": 25.19,
                "Jupiter": 3.13, "Saturn": 26.73, "Uranus": 97.77, "Neptune": 28.32}
        j = jd(2026, 11, 22)
        for name, ref in tilt.items():
            pole, _ = astro.body_axes(name, j)
            spin = tuple(-c for c in pole) if name in astro.RETROGRADE else pole
            got = _angle(spin, astro.orbit_normal(name, j))
            self.assertAlmostEqual(got, ref, delta=0.35, msg=name)

    def test_dhaka_faces_the_sun_at_noon(self):
        # at the Sun's transit, Dhaka's meridian should point at the Sun
        lat, lon = DHAKA
        j0 = jd(2026, 11, 22)
        noon, _ = astro.transit("Sun", j0, j0 + 1, lat, lon)
        pole, pm = astro.body_axes("Earth", noon)
        east = _cross(pole, pm)
        c, s = math.cos(math.radians(lon)), math.sin(math.radians(lon))
        meridian = tuple(c * p + s * e for p, e in zip(pm, east))
        sun = tuple(-v for v in astro.heliocentric("Earth", noon))
        sun_eq = tuple(v - _dot(sun, pole) * p for v, p in zip(sun, pole))
        self.assertLess(_angle(meridian, sun_eq), 0.5)

    def test_daily_rotation_is_sidereal(self):
        j = jd(2026, 11, 22)
        _, a = astro.body_axes("Earth", j)
        _, b = astro.body_axes("Earth", j + 0.99726957)  # one sidereal day
        self.assertLess(_angle(a, b), 0.01)

    def saturnicentric_latitude(self, j, of="Earth"):
        pole, _ = astro.body_axes("Saturn", j)
        sat = astro.heliocentric("Saturn", j)
        obs = astro.heliocentric("Earth", j) if of == "Earth" else (0, 0, 0)
        return 90 - _angle(pole, tuple(o - s for o, s in zip(obs, sat)))

    def test_saturn_ring_plane_crossings_2025(self):
        # Earth crossed Saturn's ring plane on 2025-03-23, the Sun on 2025-05-06
        self.assertGreater(self.saturnicentric_latitude(jd(2025, 3, 13)), 0)
        self.assertLess(self.saturnicentric_latitude(jd(2025, 4, 2)), 0)
        self.assertLess(abs(self.saturnicentric_latitude(jd(2025, 3, 23))), 0.3)
        self.assertGreater(self.saturnicentric_latitude(jd(2025, 4, 26), "Sun"), 0)
        self.assertLess(self.saturnicentric_latitude(jd(2025, 5, 16), "Sun"), 0)

    def test_saturn_rings_wide_open_2017(self):
        # maximum opening of the northern face, October 2017 (B = +26.9 deg)
        self.assertAlmostEqual(self.saturnicentric_latitude(jd(2017, 10, 16)), 26.9, delta=0.4)


class Orbits3D(unittest.TestCase):
    def test_planet_sits_on_its_orbit(self):
        j = jd(2026, 11, 22)
        for name in astro.PLANET_ORDER:
            pos = astro.heliocentric(name, j)
            path = astro.orbit_path_3d(name, j, 3600)
            gap = min(math.dist(pos, p) for p in path)
            self.assertLess(gap / math.hypot(*pos), 2e-3, name)

    def test_inclinations(self):
        j = jd(2000, 1, 1, 12)
        for name in astro.PLANET_ORDER:
            ref = astro.PLANETS[name].el[2]
            self.assertAlmostEqual(_angle(astro.orbit_normal(name, j), (0, 0, 1)), abs(ref), 4, name)

    def test_moon_vector(self):
        j = jd(2026, 11, 22)
        m = astro.moon_apparent(j)
        x, y, z = astro.moon_geocentric(j)
        self.assertAlmostEqual(math.hypot(x, y, z), m.dist_au, places=12)
        self.assertAlmostEqual(math.degrees(math.atan2(y, x)) % 360, m.lon_j2000, places=6)


if __name__ == "__main__":
    unittest.main()
