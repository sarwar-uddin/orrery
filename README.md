# Orrery

A desk orrery for KDE Plasma. It shows the solar system as it is right now,
the Moon's phase and the Sun's day, and a list of what's worth looking up at
tonight from your city. You can run the clock forwards or backwards
at up to a year per second, or jump to any date from 1800 to 2050.

![Orrery](docs/screenshot.png)

It's Python + PySide6 + Kirigami, so it picks up your Plasma colours and icons.
The ephemeris is written from scratch with no astronomy libraries:

- **Planets:** JPL's Keplerian elements (Standish, Table 1, valid 1800–2050),
  with one light-time iteration and precession to the equinox of date.
- **Moon:** the largest terms of Meeus' *Astronomical Algorithms* ch. 47, plus topocentric
  parallax when working out altitudes.
- **Rise/set, transits, phases:** sampling followed by bisection or golden-section refinement.

Checked against JPL DE421 (via skyfield), 1900–2045:

| | worst error |
|---|---|
| Sun, Moon, Mercury, Venus, Mars | ≤ 1.5′ |
| Uranus, Neptune | ≤ 2.3′ |
| Jupiter, Saturn | ≤ 9.6′ (what Table 1 promises) |
| Sun/Moon/planet rise & set (Dhaka) | ≤ 8 s |
| New/full/quarter moon times | ≤ 2.1 min |

## Use

```
./install.sh        # ~/.local/bin/orrery + menu entry, no root
orrery
```

| Key | Action |
|---|---|
| Space | play / pause (starts at 1 day/s) |
| `[` / `]` | slower or reverse / faster |
| ← / → | −1 / +1 day |
| N | back to now (live) |
| Ctrl+G | go to date |
| T | true scale ↔ log-compressed |

On the map, click a planet to get its distance, light time, magnitude, constellation,
and where it sits in your sky. The mouse wheel zooms, dragging pans, and a
double-click resets the view. The outer ring shows the zodiac constellations
(all 13, Ophiuchus included) laid out by ecliptic longitude.

**Tonight's sky** covers the stretch from dusk to dawn (Sun below −6°). It lists
when each planet is more than 8° up, plus its best time and direction. Anything
fainter than magnitude 5 is marked "binoculars", which is realistic for a city sky.

## Location

The default is Dhaka. To change it, write `~/.config/orrery/config.json`:

```json
{"name": "Sreemangal", "lat": 24.31, "lon": 91.73, "tz": "Asia/Dhaka"}
```

## Tests

```
python3 -m unittest -v tests.test_astro
```
