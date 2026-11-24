// GLSL for the 3D view. Everything is procedural except Earth's coastlines
// (a mask rasterised from Natural Earth), so the app ships no planet photos.
// The Sun sits at the world origin, so the light direction anywhere is -position.

// 3D simplex noise: Ian McEwan, Ashima Arts / Stefan Gustavson (MIT licence)
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 5; k++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
}
float fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 3; k++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
}
`;

// Saturn's rings, radius in Saturn equatorial radii (60,268 km). Edges from
// the standard ring catalogue: D 66,900, C 74,658, B 92,000, Cassini division
// 117,580-122,170, A to 136,775 (Encke gap at 133,589, 325 km wide), F 140,180.
// Returns an opacity-like density.
export const RINGS = /* glsl */ `
float bandAA(float r, float r0, float r1, float w) {
    return smoothstep(r0 - w, r0 + w, r) * (1.0 - smoothstep(r1 - w, r1 + w, r));
}
// fineAmp: how much ringlet structure to draw; the ring shader fades it out
// when a pixel spans more of it than it can show (otherwise: moire)
float saturnRing(float r, float fineAmp) {
    float w = 0.003;
    float fine = 1.0 - fineAmp * (0.5 + 0.5 * sin(r * 431.0) * sin(r * 127.0 + 1.3));
    float a = 0.0;
    a += 0.035 * bandAA(r, 1.110, 1.236, w);
    a += mix(0.10, 0.26, smoothstep(1.24, 1.52, r)) * bandAA(r, 1.239, 1.527, w) * fine;
    a += mix(0.72, 0.94, smoothstep(1.53, 1.70, r)) * bandAA(r, 1.527, 1.951, w) * fine;
    a += 0.08 * bandAA(r, 1.951, 2.027, w);
    a += 0.60 * bandAA(r, 2.027, 2.269, w) * (1.0 - bandAA(r, 2.2139, 2.2193, 0.0008)) * fine;
    a += 0.35 * bandAA(r, 2.322, 2.330, 0.002);
    return clamp(a, 0.0, 0.97);
}
vec3 saturnRingColor(float r) {
    vec3 c = vec3(0.50, 0.46, 0.42);                                   // C ring, dusty grey
    c = mix(c, vec3(0.94, 0.86, 0.70), smoothstep(1.50, 1.56, r));     // B ring
    c = mix(c, vec3(0.40, 0.37, 0.34), smoothstep(1.94, 1.96, r));     // Cassini division
    c = mix(c, vec3(0.80, 0.75, 0.66), smoothstep(2.02, 2.04, r));     // A ring
    return c;
}
// Uranus: the nine classical narrow rings (6, 5, 4, alpha, beta, eta, gamma, delta, epsilon),
// radii in Uranus equatorial radii (25,559 km), widths exaggerated so they show at all.
float uranusRing(float r) {
    float a = 0.0;
    a += bandAA(r, 1.6365, 1.6405, 0.001) + bandAA(r, 1.6505, 1.6545, 0.001);
    a += bandAA(r, 1.6625, 1.6665, 0.001) + bandAA(r, 1.7470, 1.7520, 0.001);
    a += bandAA(r, 1.7870, 1.7920, 0.001) + bandAA(r, 1.8460, 1.8500, 0.001);
    a += bandAA(r, 1.8620, 1.8660, 0.001) + bandAA(r, 1.8890, 1.8940, 0.001);
    a += 1.4 * bandAA(r, 1.9930, 2.0090, 0.001);
    return clamp(a * 0.3, 0.0, 0.5);
}
`;

const PLANET_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
void main() {
    vObj = position;
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// styles: 0 Mercury, 1 Venus, 2 Earth, 3 Mars, 4 Jupiter, 5 Saturn, 6 Uranus, 7 Neptune, 8 Moon
const PLANET_FRAG = /* glsl */ `
uniform int uStyle;
uniform float uTime;
uniform sampler2D uMask;
uniform bool uHasRing;
uniform vec3 uRingCenter;
uniform vec3 uRingPole;
uniform float uRingRadius;
uniform bool uLightOverride;
uniform vec3 uLightDir;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
${NOISE}
${RINGS}

vec3 bands(float latDeg, vec3 light, vec3 dark, float freq) {
    return mix(light, dark, smoothstep(0.25, 0.85, 0.5 + 0.5 * sin(latDeg * freq)));
}

void main() {
    vec3 p = normalize(vObj);
    vec3 N = normalize(vNormalW);
    vec3 L = uLightOverride ? normalize(uLightDir) : normalize(-vWorld);
    vec3 V = normalize(cameraPosition - vWorld);
    float lat = degrees(asin(clamp(p.y, -1.0, 1.0)));
    float lon = degrees(atan(-p.z, p.x));
    float ndl = dot(N, L);
    float diffuse = max(ndl, 0.0);
    vec3 albedo;
    float spec = 0.0;
    float wrap = 0.0;         // thick atmospheres scatter light a little past the terminator

    if (uStyle == 0 || uStyle == 8) {          // Mercury, Moon: grey regolith and craters
        float n = fbm(p * 5.0) * 0.5 + 0.5;
        float cr = 1.0 - smoothstep(0.0, 0.12, abs(snoise(p * 14.0)));
        albedo = vec3(0.55, 0.52, 0.49) * (0.75 + 0.4 * n) - 0.08 * cr;
        if (uStyle == 0) albedo *= vec3(1.0, 0.96, 0.9);
        else {
            // maria cluster on the near side, which faces Earth (local +Z)
            float maria = smoothstep(0.05, 0.35, fbm3(p * 1.7 + 4.0)) * smoothstep(-0.3, 0.4, p.z);
            albedo = mix(albedo, vec3(0.24, 0.24, 0.25), maria * 0.85);
        }
    } else if (uStyle == 1) {                  // Venus: unbroken sulphuric-acid cloud deck
        float n = fbm(p * vec3(2.0, 5.0, 2.0) + vec3(uTime * 0.004, 0.0, 0.0));
        albedo = mix(vec3(0.90, 0.80, 0.58), vec3(0.98, 0.93, 0.80), 0.5 + 0.5 * n);
        wrap = 0.12;
    } else if (uStyle == 2) {                  // Earth
        vec3 m = texture2D(uMask, vUv).rgb;
        float land = m.r, ice = m.g;
        float n = fbm(p * 7.0);
        float alat = abs(lat);
        vec3 forest = vec3(0.07, 0.17, 0.06), grass = vec3(0.22, 0.28, 0.11);
        vec3 desert = vec3(0.60, 0.48, 0.30), tundra = vec3(0.33, 0.31, 0.26);
        float dry = smoothstep(0.15, 0.75, (1.0 - abs(alat - 24.0) / 14.0) + 0.6 * n);
        vec3 ground = mix(forest, grass, 0.5 + 0.5 * n);
        ground = mix(ground, desert, clamp(dry, 0.0, 1.0));
        ground = mix(ground, tundra, smoothstep(52.0, 64.0, alat + 6.0 * n));
        ground = mix(ground, vec3(0.92, 0.94, 0.97), ice);
        vec3 ocean = mix(vec3(0.015, 0.05, 0.16), vec3(0.03, 0.10, 0.25), 0.5 + 0.5 * n);
        float seaIce = smoothstep(70.0, 78.0, alat + 5.0 * n) * (1.0 - land);
        albedo = mix(mix(ocean, ground, land), vec3(0.85, 0.9, 0.95), seaIce);
        // clouds: a drifting deck, a band along the tropics, storm tracks at mid latitudes
        float c = fbm(p * 3.2 + vec3(0.0, 0.0, uTime * 0.006)) + 0.35 * fbm3(p * 11.0);
        c += 0.25 * exp(-pow((lat - 5.0) / 7.0, 2.0)) + 0.18 * exp(-pow((alat - 55.0) / 10.0, 2.0));
        float cloud = smoothstep(0.12, 0.55, c) * 0.85;
        vec3 H = normalize(L + V);
        spec = pow(max(dot(N, H), 0.0), 70.0) * 0.55 * (1.0 - land) * (1.0 - seaIce) * (1.0 - cloud);
        albedo = mix(albedo, vec3(0.95), cloud);
        wrap = 0.04;
    } else if (uStyle == 3) {                  // Mars
        float n = fbm(p * 4.0);
        float dark = smoothstep(0.0, 0.4, fbm3(p * 2.2 + 8.0)) * (1.0 - smoothstep(35.0, 60.0, lat));
        albedo = mix(vec3(0.66, 0.33, 0.16), vec3(0.78, 0.47, 0.27), 0.5 + 0.5 * n);
        albedo = mix(albedo, vec3(0.32, 0.18, 0.11), dark * 0.7);
        float cap = smoothstep(77.0, 81.0, abs(lat) + 3.0 * n);
        albedo = mix(albedo, vec3(0.95, 0.93, 0.9), cap);
    } else if (uStyle == 4) {                  // Jupiter
        float warp = lat + 2.2 * fbm(p * vec3(3.0, 12.0, 3.0)) + 0.8 * snoise(p * 25.0);
        vec3 c = bands(warp, vec3(0.92, 0.86, 0.74), vec3(0.73, 0.57, 0.42), 0.36);
        // the two dark equatorial belts, either side of the bright equatorial zone
        float belt = bandAA(warp, 7.0, 17.0, 1.5) + bandAA(warp, -20.0, -8.0, 1.5);
        c = mix(c, vec3(0.55, 0.38, 0.27), belt * 0.75);
        c = mix(c, vec3(0.58, 0.56, 0.56), smoothstep(48.0, 72.0, abs(warp)));
        // the Great Red Spot, 22 deg south (its System III longitude drifts; this is a likeness)
        float dl = mod(lon - 60.0 + 180.0, 360.0) - 180.0;
        float spot = (dl / 11.0) * (dl / 11.0) + ((lat + 22.0) / 5.0) * ((lat + 22.0) / 5.0);
        c = mix(c, vec3(0.74, 0.36, 0.22), (1.0 - smoothstep(0.55, 1.0, spot)) * 0.85);
        albedo = c;
    } else if (uStyle == 5) {                  // Saturn
        float warp = lat + 1.5 * fbm3(p * vec3(2.0, 10.0, 2.0));
        albedo = bands(warp, vec3(0.90, 0.81, 0.60), vec3(0.78, 0.67, 0.46), 0.42);
        albedo = mix(albedo, vec3(0.62, 0.66, 0.70), smoothstep(60.0, 80.0, warp));
    } else if (uStyle == 6) {                  // Uranus
        albedo = vec3(0.62, 0.84, 0.87) * (0.96 + 0.04 * sin(lat * 0.3 + fbm3(p * 4.0)));
    } else {                                   // Neptune
        float warp = lat + 3.0 * fbm3(p * vec3(2.0, 8.0, 2.0));
        albedo = bands(warp, vec3(0.28, 0.45, 0.88), vec3(0.20, 0.33, 0.74), 0.25);
        float streak = smoothstep(0.55, 0.8, snoise(p * vec3(2.0, 18.0, 2.0) + 3.0));
        albedo = mix(albedo, vec3(0.85, 0.9, 1.0), streak * 0.5 * step(abs(lat - 25.0), 15.0));
    }

    float light = uStyle == 8 || uStyle == 0 ? diffuse
                : clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);

    // Saturn: the rings' shadow on the globe
    if (uHasRing) {
        float dn = dot(L, uRingPole);
        if (abs(dn) > 1e-4) {
            float t = dot(uRingCenter - vWorld, uRingPole) / dn;
            if (t > 0.0) {
                float r = length(vWorld + L * t - uRingCenter) / uRingRadius;
                light *= 1.0 - 0.9 * saturnRing(r, 0.0);
            }
        }
    }

    vec3 col = albedo * light + spec;
    // a hint of earthshine/skyglow so the night side isn't a hole
    col += albedo * 0.012;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export const planetShader = { vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG };

export const ringShader = {
    vertexShader: /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform int uKind;          // 0 Saturn, 1 Uranus
uniform vec3 uCenter;
uniform vec3 uPole;
uniform float uRadius;      // planet radius, world units (the planet is a sphere here)
varying vec3 vLocal;
varying vec3 vWorld;
${RINGS}
void main() {
    float r = length(vLocal.xz);
    float fw = fwidth(r);
    float a = uKind == 0 ? saturnRing(r, 0.3 * (1.0 - smoothstep(0.0015, 0.006, fw))) : uranusRing(r);
    if (a < 0.004) discard;
    vec3 col = uKind == 0 ? saturnRingColor(r) : vec3(0.16, 0.16, 0.17);   // Uranus' rings are coal-dark
    vec3 L = normalize(-vWorld);
    vec3 V = normalize(cameraPosition - vWorld);
    float sunUp = dot(L, uPole), camUp = dot(V, uPole);
    // lit face: reflected light, weaker as the Sun skims the ring plane.
    // unlit face: only what diffuses through, so thin rings glow and the B ring goes dark.
    float elev = pow(abs(sunUp), 0.35);
    float lit = sunUp * camUp >= 0.0 ? 1.0 : 0.35 * (1.0 - a);
    float b = elev * lit;
    // the planet's shadow across the rings
    vec3 oc = vWorld - uCenter;
    float h = dot(oc, L);
    float c = dot(oc, oc) - uRadius * uRadius;
    if (h < 0.0 && h * h - c > 0.0) b *= 0.05;
    gl_FragColor = vec4(col * b, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`,
};

export const atmosphereShader = {
    vertexShader: /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uStrength;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(-vWorld);
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uPower);
    float day = smoothstep(-0.3, 0.4, dot(N, L));
    gl_FragColor = vec4(uColor * rim * day * uStrength, 1.0);
}`,
};

export const sunShader = {
    vertexShader: PLANET_VERT,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vUv;
${NOISE}
void main() {
    vec3 p = normalize(vObj);
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = clamp(dot(normalize(vNormalW), V), 0.0, 1.0);
    float gran = snoise(p * 38.0 + vec3(0.0, 0.0, uTime * 0.05)) * 0.5 + 0.5;
    float cells = fbm3(p * 9.0 + vec3(uTime * 0.01));
    // sunspots stay within ~35 deg of the solar equator
    float spots = smoothstep(0.55, 0.7, snoise(p * 4.0 + 31.0)) * (1.0 - smoothstep(0.35, 0.6, abs(p.y)));
    vec3 col = vec3(1.0, 0.80, 0.48) * (0.82 + 0.16 * gran + 0.1 * cells);
    col *= 1.0 - 0.75 * spots;
    // limb darkening (Eddington approximation, u = 0.6)
    col *= 1.0 - 0.6 * (1.0 - mu);
    col = mix(col * vec3(1.0, 0.75, 0.55), col, mu);
    gl_FragColor = vec4(col * 2.4, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`,
};

// Baked once into an equirectangular target (see bakeMilkyWay): a full-screen
// quad whose UV is turned into the direction SphereGeometry puts at that UV.
export const milkyWayShader = {
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uGNP;
uniform vec3 uGC;
uniform vec3 uGY;
uniform float uStrength;
varying vec2 vUv;
${NOISE}
void main() {
    // per pixel: interpolating a direction across the quad would bend it
    float phi = vUv.x * 6.28318530718;
    float theta = (1.0 - vUv.y) * 3.14159265359;
    vec3 d = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
    float b = asin(clamp(dot(d, uGNP), -1.0, 1.0));
    float l = atan(dot(d, uGY), dot(d, uGC));
    float n = fbm(d * 5.0) * 0.5 + 0.5;
    float band = exp(-pow(b / (0.13 + 0.05 * n), 2.0)) * (0.55 + 0.45 * cos(l * 0.5) * cos(l * 0.5));
    float bulge = exp(-pow(l / 0.5, 2.0) - pow(b / 0.2, 2.0));
    float dust = smoothstep(0.5, 0.8, fbm(d * 13.0 + 3.0) * 0.5 + 0.5 + 0.25)
               * exp(-pow(b / 0.045, 2.0)) * (0.4 + 0.6 * exp(-pow(l / 1.4, 2.0)));
    float glow = (band * (0.3 + 0.7 * n) + bulge * 0.9) * (1.0 - 0.8 * dust);
    vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.84, 0.66), clamp(bulge * 1.5, 0.0, 1.0));
    gl_FragColor = vec4(col * glow * uStrength, 1.0);
}`,
};

export const starShader = {
    vertexShader: /* glsl */ `
attribute float mag;
attribute vec3 color;
uniform float uPixelRatio;
uniform float uZoom;
varying vec3 vColor;
varying float vBright;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float flux = pow(10.0, -0.4 * (mag - 1.0));        // relative to a 1st-magnitude star
    gl_PointSize = clamp(2.2 * pow(flux, 0.28) * uZoom, 1.0, 9.0) * uPixelRatio;
    vBright = clamp(0.18 + 0.82 * pow(flux, 0.45), 0.0, 1.8);
    vColor = color;
}`,
    fragmentShader: /* glsl */ `
varying vec3 vColor;
varying float vBright;
void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.0, 1.0, d);
    gl_FragColor = vec4(vColor * vBright * a * a, 1.0);
}`,
};

export const beltShader = {
    vertexShader: /* glsl */ `
attribute vec4 el0;     // a, e, i, node
attribute vec3 el1;     // argument of perihelion, mean anomaly at J2000, mean motion (rad/day)
uniform float uDays;
uniform bool uTrue;
uniform float uPixelRatio;
uniform float uSize;
varying float vFade;
float radial(float r) {
    return uTrue ? r / 30.07 * 100.0 : log(1.0 + r / 0.35) / log(1.0 + 30.07 / 0.35) * 100.0;
}
void main() {
    float a = el0.x, e = el0.y, inc = el0.z, node = el0.w, peri = el1.x;
    float M = mod(el1.y + el1.z * uDays, 6.28318530718);
    float E = M + e * sin(M);
    for (int k = 0; k < 6; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    float xp = a * (cos(E) - e), yp = a * sqrt(1.0 - e * e) * sin(E);
    float co = cos(peri), so = sin(peri), cn = cos(node), sn = sin(node), ci = cos(inc), si = sin(inc);
    vec3 q = vec3((co * cn - so * sn * ci) * xp + (-so * cn - co * sn * ci) * yp,
                  (co * sn + so * cn * ci) * xp + (-so * sn + co * cn * ci) * yp,
                  (so * si) * xp + (co * si) * yp);
    float r = length(q);
    vec3 s = vec3(q.x, q.z, -q.y) * (radial(r) / r);
    vec4 mv = modelViewMatrix * vec4(s, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * 90.0 / -mv.z, 0.8, 3.0) * uPixelRatio;
    vFade = clamp(uSize * 90.0 / -mv.z, 0.25, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor * vFade * (1.0 - d * d), 1.0);
}`,
};
