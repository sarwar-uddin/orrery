// Pure maths shared by the scene and the tests: no three.js in here.
//
// Coordinates: the ephemeris speaks heliocentric ecliptic J2000 (x towards the
// March equinox, z towards the north ecliptic pole). three.js is y-up, so a
// vector (x, y, z) goes to (x, z, -y) — a proper rotation, so handedness and
// cross products survive the trip.

export const NEPTUNE_A = 30.07;   // AU, the edge of the map
export const OUTER = 100;         // scene units at Neptune's distance
export const LOG_K = 0.35;        // AU; the same compression as the 2D map

// AU from the Sun -> scene units from the Sun.
// Compressed: log(1 + r/k), so the inner planets get room and Neptune still fits.
// True: linear. Directions are never touched, so inclinations stay honest.
export function radial(r, trueScale) {
    if (trueScale) return r / NEPTUNE_A * OUTER;
    return Math.log(1 + r / LOG_K) / Math.log(1 + NEPTUNE_A / LOG_K) * OUTER;
}

// ecliptic direction -> scene direction (no scaling)
export function eclToScene(v) {
    return [v[0], v[2], -v[1]];
}

// heliocentric ecliptic position (AU) -> scene position
export function toScene(v, trueScale) {
    const r = Math.hypot(v[0], v[1], v[2]);
    if (r === 0) return [0, 0, 0];
    const k = radial(r, trueScale) / r;
    return [v[0] * k, v[2] * k, -v[1] * k];
}

// J2000 equatorial RA/Dec (degrees) -> ecliptic unit vector
const EPS = 23.4392911 * Math.PI / 180;
export function equatorialToEcliptic(raDeg, decDeg) {
    const a = raDeg * Math.PI / 180, d = decDeg * Math.PI / 180;
    const x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
    return [x, Math.cos(EPS) * y + Math.sin(EPS) * z, -Math.sin(EPS) * y + Math.cos(EPS) * z];
}

// ecliptic longitude/latitude (degrees) -> ecliptic unit vector
export function eclipticLonLat(lonDeg, latDeg = 0) {
    const l = lonDeg * Math.PI / 180, b = latDeg * Math.PI / 180;
    return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}

export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// A body's local frame from its IAU axes (both already in scene coordinates):
// local +Y = north pole, local +X = prime meridian, local +Z = X x Y.
// With three's SphereGeometry an equirectangular map (longitude -180..180,
// left to right) then lands with east longitude increasing the right way:
// east = pole x meridian = -Z.
export function bodyBasis(pole, pm) {
    return { x: pm, y: pole, z: cross(pm, pole) };
}

// Mean motion (radians/day) of a heliocentric orbit with semi-major axis a (AU).
export const GAUSS_K = 0.01720209895;
export function meanMotion(a) {
    return GAUSS_K / Math.pow(a, 1.5);
}

// Kirkwood gaps: mean-motion resonances with Jupiter that the main belt avoids.
// a = a_J * (p/q)^(2/3) for the 4:1, 3:1, 5:2, 7:3 and 2:1 resonances.
export const JUPITER_A = 5.2029;
export const KIRKWOOD = [[4, 1], [3, 1], [5, 2], [7, 3], [2, 1]].map(
    ([p, q]) => JUPITER_A * Math.pow(q / p, 2 / 3));

// Deterministic PRNG so the belt and the background stars are the same every launch.
export function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function gaussian(rnd) {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

// Synthetic main belt + Jupiter trojans. Every particle is a Keplerian orbit:
// [a, e, i, node, argPeri, meanAnomalyAtJ2000, meanMotion] (AU, radians, rad/day).
export function makeBelt(count, seed = 7) {
    const rnd = mulberry32(seed);
    const out = [];
    const [, gap31, gap52, gap73] = KIRKWOOD;
    while (out.length < count) {
        const a = 2.1 + rnd() * 1.2;
        // the resonances clear out lanes about 0.02-0.04 AU wide
        if ([gap31, gap52, gap73].some(g => Math.abs(a - g) < 0.025)) continue;
        const e = Math.min(0.3, Math.abs(gaussian(rnd)) * 0.09);
        const i = Math.min(0.5, Math.abs(gaussian(rnd)) * 0.13);
        out.push([a, e, i, rnd() * 2 * Math.PI, rnd() * 2 * Math.PI, rnd() * 2 * Math.PI,
                  meanMotion(a)]);
    }
    return out;
}

// Trojans share Jupiter's orbit 60 degrees ahead (L4) and behind (L5) of it.
// jupiter = {L0, n, a}: mean longitude at J2000 and mean motion (radians, rad/day).
export function makeTrojans(count, jupiter, seed = 11) {
    const rnd = mulberry32(seed);
    const out = [];
    for (let k = 0; k < count; k++) {
        const lead = k % 2 === 0 ? 1 : -1;
        const lambda = jupiter.L0 + lead * Math.PI / 3 + gaussian(rnd) * 0.22;
        const e = Math.abs(gaussian(rnd)) * 0.05;
        const i = Math.abs(gaussian(rnd)) * 0.2;
        const node = rnd() * 2 * Math.PI, peri = rnd() * 2 * Math.PI;
        const M0 = lambda - node - peri;
        out.push([jupiter.a * (1 + gaussian(rnd) * 0.012), e, i, node, peri, M0, jupiter.n]);
    }
    return out;
}

// Same solver the shader runs, kept here so it can be tested.
export function keplerPosition([a, e, i, node, peri, M0, n], days) {
    let M = (M0 + n * days) % (2 * Math.PI);
    let E = M + e * Math.sin(M);
    for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const co = Math.cos(peri), so = Math.sin(peri), cn = Math.cos(node), sn = Math.sin(node);
    const ci = Math.cos(i), si = Math.sin(i);
    return [
        (co * cn - so * sn * ci) * xp + (-so * cn - co * sn * ci) * yp,
        (co * sn + so * cn * ci) * xp + (-so * sn + co * cn * ci) * yp,
        (so * si) * xp + (co * si) * yp,
    ];
}
