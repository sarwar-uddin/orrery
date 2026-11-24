// The sky behind the planets.
//
// The bright stars are real: J2000 right ascension and declination (degrees),
// V magnitude and B-V colour index, from the Yale Bright Star Catalogue (5th ed.).
// That is enough for Orion, the Plough, Scorpius, Cassiopeia, the Southern Cross
// and the zodiac to be where they belong, so a planet in the "From Earth" view
// sits in front of the right stars. The faint ones are a seeded random scatter,
// thickened along the real galactic plane, just for texture.

import { equatorialToEcliptic, mulberry32, gaussian, cross } from "./scale.js";

// name, RA, Dec, V, B-V
export const BRIGHT_STARS = [
    ["Sirius", 101.287, -16.716, -1.46, 0.00], ["Canopus", 95.988, -52.696, -0.74, 0.15],
    ["Rigil Kentaurus", 219.902, -60.834, -0.27, 0.71], ["Arcturus", 213.915, 19.182, -0.05, 1.23],
    ["Vega", 279.235, 38.784, 0.03, 0.00], ["Capella", 79.172, 45.998, 0.08, 0.80],
    ["Rigel", 78.634, -8.202, 0.13, -0.03], ["Procyon", 114.825, 5.225, 0.34, 0.42],
    ["Achernar", 24.429, -57.237, 0.46, -0.16], ["Betelgeuse", 88.793, 7.407, 0.50, 1.85],
    ["Hadar", 210.956, -60.373, 0.61, -0.23], ["Altair", 297.696, 8.868, 0.77, 0.22],
    ["Acrux", 186.650, -63.099, 0.76, -0.24], ["Aldebaran", 68.980, 16.509, 0.86, 1.54],
    ["Antares", 247.352, -26.432, 0.96, 1.83], ["Spica", 201.298, -11.161, 0.97, -0.23],
    ["Pollux", 116.329, 28.026, 1.14, 1.00], ["Fomalhaut", 344.413, -29.622, 1.16, 0.09],
    ["Deneb", 310.358, 45.280, 1.25, 0.09], ["Mimosa", 191.930, -59.689, 1.25, -0.23],
    ["Regulus", 152.093, 11.967, 1.40, -0.11], ["Adhara", 104.656, -28.972, 1.50, -0.21],
    ["Castor", 113.650, 31.888, 1.58, 0.03], ["Shaula", 263.402, -37.104, 1.62, -0.22],
    ["Gacrux", 187.791, -57.113, 1.64, 1.59], ["Bellatrix", 81.283, 6.350, 1.64, -0.22],
    ["Elnath", 81.573, 28.608, 1.65, -0.13], ["Miaplacidus", 138.300, -69.717, 1.67, 0.07],
    ["Alnilam", 84.053, -1.202, 1.69, -0.18], ["Alnair", 332.058, -46.961, 1.74, -0.13],
    ["Alnitak", 85.190, -1.943, 1.77, -0.21], ["Alioth", 193.507, 55.960, 1.77, -0.02],
    ["Dubhe", 165.932, 61.751, 1.79, 1.07], ["Mirfak", 51.081, 49.861, 1.79, 0.48],
    ["Wezen", 107.098, -26.393, 1.83, 0.68], ["Kaus Australis", 276.043, -34.385, 1.85, -0.03],
    ["Avior", 125.628, -59.510, 1.86, 1.28], ["Alkaid", 206.885, 49.313, 1.86, -0.19],
    ["Sargas", 264.330, -42.998, 1.87, 0.40], ["Menkalinan", 89.882, 44.948, 1.90, 0.08],
    ["Atria", 252.166, -69.028, 1.91, 1.44], ["Alhena", 99.428, 16.399, 1.92, 0.00],
    ["Peacock", 306.412, -56.735, 1.94, -0.20], ["Polaris", 37.955, 89.264, 1.98, 0.60],
    ["Mirzam", 95.675, -17.956, 1.98, -0.23], ["Alphard", 141.897, -8.659, 1.98, 1.44],
    ["Algieba", 154.993, 19.842, 2.01, 1.13], ["Hamal", 31.793, 23.462, 2.00, 1.15],
    ["Diphda", 10.897, -17.987, 2.04, 1.02], ["Nunki", 283.816, -26.297, 2.05, -0.13],
    ["Menkent", 211.671, -36.370, 2.06, 1.01], ["Saiph", 86.939, -9.670, 2.06, -0.17],
    ["Alpheratz", 2.097, 29.091, 2.06, -0.11], ["Mirach", 17.433, 35.621, 2.05, 1.58],
    ["Kochab", 222.676, 74.156, 2.08, 1.47], ["Rasalhague", 263.734, 12.560, 2.08, 0.15],
    ["Algol", 47.042, 40.956, 2.12, -0.05], ["Denebola", 177.265, 14.572, 2.13, 0.09],
    ["Naos", 120.896, -40.003, 2.21, -0.27], ["Suhail", 136.999, -43.433, 2.21, 1.66],
    ["Alphecca", 233.672, 26.715, 2.23, -0.02], ["Mizar", 200.981, 54.925, 2.23, 0.02],
    ["Sadr", 305.557, 40.257, 2.23, 0.67], ["Mintaka", 83.002, -0.299, 2.23, -0.22],
    ["Schedar", 10.127, 56.537, 2.24, 1.17], ["Eltanin", 269.152, 51.489, 2.24, 1.52],
    ["Aspidiske", 139.273, -59.275, 2.25, 0.18], ["Caph", 2.295, 59.150, 2.28, 0.34],
    ["Dschubba", 240.083, -22.622, 2.29, -0.12], ["Larawag", 252.541, -34.293, 2.29, 1.15],
    ["Merak", 165.460, 56.382, 2.37, -0.02], ["Izar", 221.247, 27.074, 2.37, 0.97],
    ["Enif", 326.046, 9.875, 2.39, 1.52], ["Scheat", 345.944, 28.083, 2.42, 1.67],
    ["Sabik", 257.595, -15.725, 2.43, 0.06], ["Phecda", 178.458, 53.695, 2.44, 0.04],
    ["Alderamin", 319.645, 62.586, 2.45, 0.22], ["Navi", 14.177, 60.717, 2.47, -0.15],
    ["Aljanah", 311.553, 33.970, 2.48, 1.03], ["Markab", 346.190, 15.205, 2.49, -0.04],
    ["Menkar", 45.570, 4.090, 2.54, 1.64], ["Zosma", 168.527, 20.524, 2.56, 0.12],
    ["Ascella", 285.653, -29.880, 2.60, 0.08], ["Zubeneschamali", 229.252, -9.383, 2.61, -0.11],
    ["Acrab", 241.359, -19.806, 2.62, -0.07], ["Unukalhai", 236.067, 6.426, 2.63, 1.17],
    ["Ruchbah", 21.454, 60.235, 2.68, 0.13], ["Kaus Media", 275.249, -29.828, 2.70, 1.38],
    ["Tarazed", 296.565, 10.613, 2.72, 1.51], ["Porrima", 190.415, -1.449, 2.74, 0.36],
    ["Zubenelgenubi", 222.720, -16.042, 2.75, 0.15], ["Kaus Borealis", 276.993, -25.421, 2.81, 1.04],
    ["Algenib", 3.309, 15.184, 2.83, -0.23], ["Vindemiatrix", 195.544, 10.959, 2.83, 0.94],
    ["Alcyone", 56.871, 24.105, 2.87, -0.09], ["Alnasl", 271.452, -30.424, 2.98, 1.00],
    ["Albireo", 292.680, 27.960, 3.05, 1.09], ["Megrez", 183.857, 57.033, 3.31, 0.08],
    ["Segin", 28.599, 63.670, 3.38, -0.15], ["Meissa", 83.784, 9.934, 3.39, -0.18],
];

// Galactic frame (IAU 1958, J2000 coordinates of the pole and the centre)
export const GALACTIC_POLE = equatorialToEcliptic(192.85948, 27.12825);
export const GALACTIC_CENTRE = equatorialToEcliptic(266.40499, -28.93617);

// B-V colour index -> linear-ish RGB (Ballesteros' formula for temperature,
// then a blackbody approximation good enough for star dots)
export function starColor(bv) {
    const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    const k = t / 100;
    let r, g, b;
    r = k <= 66 ? 255 : 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = k <= 66 ? 99.4708025861 * Math.log(k) - 161.1195681661
                : 288.1221695283 * Math.pow(k - 60, -0.0755148492);
    b = k >= 66 ? 255 : (k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307);
    const c = x => Math.min(255, Math.max(0, x)) / 255;
    // pull towards white: eyes see stars far less saturated than blackbodies
    return [c(r), c(g), c(b)].map(v => 0.45 + 0.55 * v);
}

// -> { positions: Float32Array (ecliptic unit vectors), colors, mags }
export function makeStarfield(faintCount, seed = 1337) {
    const pos = [], col = [], mag = [];
    for (const [, ra, dec, v, bv] of BRIGHT_STARS) {
        pos.push(...equatorialToEcliptic(ra, dec));
        col.push(...starColor(bv));
        mag.push(v);
    }
    const rnd = mulberry32(seed);
    const gy = cross(GALACTIC_POLE, GALACTIC_CENTRE);   // galactic l = 90 deg
    for (let k = 0; k < faintCount; k++) {
        let x, y, z;
        if (rnd() < 0.55) {
            // in the band of the Milky Way, denser towards the centre
            const l = rnd() < 0.4 ? gaussian(rnd) * 0.9 : rnd() * 2 * Math.PI;
            const b = gaussian(rnd) * 0.16;
            const cb = Math.cos(b);
            x = cb * Math.cos(l); y = cb * Math.sin(l); z = Math.sin(b);
            const v = [0, 1, 2].map(i => x * GALACTIC_CENTRE[i] + y * gy[i] + z * GALACTIC_POLE[i]);
            [x, y, z] = v;
        } else {
            z = rnd() * 2 - 1;
            const t = rnd() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
            x = s * Math.cos(t); y = s * Math.sin(t);
        }
        pos.push(x, y, z);
        // more faint stars than bright ones (roughly N ~ 10^(0.5 m))
        const m = 6.6 - 3.1 * Math.pow(rnd(), 2.2);
        mag.push(m);
        col.push(...starColor(-0.2 + rnd() * 1.8));
    }
    return { positions: new Float32Array(pos), colors: new Float32Array(col), mags: new Float32Array(mag) };
}
