import { test } from "node:test";
import assert from "node:assert/strict";
import {
    radial, toScene, eclToScene, cross, bodyBasis, equatorialToEcliptic, KIRKWOOD,
    makeBelt, makeTrojans, keplerPosition, meanMotion, NEPTUNE_A, OUTER,
} from "../src/scale.js";
import { BRIGHT_STARS, GALACTIC_POLE, GALACTIC_CENTRE, makeStarfield } from "../src/stars.js";

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} vs ${b}`);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r) => r * 180 / Math.PI;

test("both scales put Neptune at the edge and keep 0 at 0", () => {
    for (const t of [false, true]) {
        close(radial(NEPTUNE_A, t), OUTER, 1e-9);
        assert.equal(radial(0, t), 0);
    }
    // compressed is monotonic and gives the inner system more room than linear
    let prev = 0;
    for (let r = 0.1; r < 40; r += 0.1) { const v = radial(r, false); assert.ok(v > prev); prev = v; }
    assert.ok(radial(1, false) > 5 * radial(1, true));
});

test("ecliptic -> scene is a proper rotation with north up", () => {
    eclToScene([0, 0, 1]).forEach((v, i) => close(v, [0, 1, 0][i], 0));
    const a = [0.3, -0.5, 0.8], b = [-0.7, 0.2, 0.4];
    const lhs = eclToScene(cross(a, b)), rhs = cross(eclToScene(a), eclToScene(b));
    lhs.forEach((v, i) => close(v, rhs[i], 1e-12));
});

test("toScene keeps directions (so inclinations survive the compression)", () => {
    const p = [3.1, -1.2, 0.4];
    const s = toScene(p, false), e = eclToScene(p);
    const c = dot(s, e) / Math.hypot(...s) / Math.hypot(...e);
    close(c, 1, 1e-12);
});

test("body basis is right-handed with east = -Z", () => {
    const pole = [0, 1, 0], pm = [1, 0, 0];
    const b = bodyBasis(pole, pm);
    b.z.forEach((v, i) => close(v, [0, 0, 1][i], 0));
    // east = pole x pm
    cross(pole, pm).forEach((v, i) => close(v, [0, 0, -1][i], 0));
});

test("equatorial -> ecliptic: the north celestial pole tilts by the obliquity", () => {
    const ncp = equatorialToEcliptic(0, 90);
    close(deg(Math.acos(ncp[2])), 23.4392911, 1e-9);
    // Regulus sits almost on the ecliptic (latitude +0.46 deg)
    const [, ra, dec] = BRIGHT_STARS.find(s => s[0] === "Regulus");
    close(deg(Math.asin(equatorialToEcliptic(ra, dec)[2])), 0.46, 0.05, "Regulus");
    // Spica: ecliptic latitude -2.05 deg
    const [, ra2, dec2] = BRIGHT_STARS.find(s => s[0] === "Spica");
    close(deg(Math.asin(equatorialToEcliptic(ra2, dec2)[2])), -2.05, 0.05, "Spica");
});

test("galactic frame: pole and centre are perpendicular", () => {
    close(dot(GALACTIC_POLE, GALACTIC_CENTRE), 0, 1e-4);
});

test("Kirkwood gaps sit where they are observed", () => {
    const [g41, g31, g52, g73, g21] = KIRKWOOD;
    close(g41, 2.065, 0.01); close(g31, 2.502, 0.01); close(g52, 2.825, 0.01);
    close(g73, 2.958, 0.01); close(g21, 3.279, 0.01);
    const belt = makeBelt(3000);
    assert.equal(belt.length, 3000);
    for (const [a] of belt) for (const g of [g31, g52, g73]) assert.ok(Math.abs(a - g) >= 0.025);
});

test("Kepler solver: one period brings a particle home; mean motion is Kepler's third law", () => {
    close(2 * Math.PI / meanMotion(1), 365.2569, 0.01);
    const el = [2.7, 0.15, 0.2, 1.0, 2.0, 0.5, meanMotion(2.7)];
    const p0 = keplerPosition(el, 0), p1 = keplerPosition(el, 2 * Math.PI / el[6]);
    p0.forEach((v, i) => close(v, p1[i], 1e-9));
    const r = Math.hypot(...p0);
    assert.ok(r >= 2.7 * 0.85 - 1e-9 && r <= 2.7 * 1.15 + 1e-9);
});

test("trojans lead and trail Jupiter by about 60 degrees", () => {
    const jup = { a: 5.2, L0: 0.6, n: 0.00145 };
    const tro = makeTrojans(2000, jup);
    let lead = 0, trail = 0;
    for (const t of tro) {
        const p = keplerPosition(t, 0);
        const d = ((Math.atan2(p[1], p[0]) - jup.L0) * 180 / Math.PI + 540) % 360 - 180;
        if (d > 30 && d < 90) lead++;
        if (d < -30 && d > -90) trail++;
    }
    assert.ok(lead > 700 && trail > 700, `${lead} ${trail}`);
});

test("starfield is deterministic and the right size", () => {
    const a = makeStarfield(100), b = makeStarfield(100);
    assert.equal(a.mags.length, BRIGHT_STARS.length + 100);
    assert.deepEqual(a.positions, b.positions);
    for (let i = 0; i < a.positions.length; i += 3) {
        close(Math.hypot(a.positions[i], a.positions[i + 1], a.positions[i + 2]), 1, 1e-5);
    }
});
