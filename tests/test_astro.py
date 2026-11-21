"""Checks against JPL DE421 (computed once with skyfield; values pinned here so
the tests need nothing but the standard library)."""

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


if __name__ == "__main__":
    unittest.main()
