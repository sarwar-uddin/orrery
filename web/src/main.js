// Orrery 3D: the three.js scene inside the Qt WebEngine view.
//
// The Python ephemeris stays the single source of truth: QML pushes a JSON
// snapshot in through window.orrery.update() on every clock tick, and clicks
// go back out over the Qt WebChannel ("bridge" object). Nothing in here works
// out where a planet is; it only draws what it is told.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

import { radial, toScene, eclToScene, eclipticLonLat, bodyBasis, makeBelt, makeTrojans, cross } from "./scale.js";
import { planetShader, ringShader, atmosphereShader, sunShader, milkyWayShader, starShader, beltShader } from "./shaders.js";
import { makeStarfield, GALACTIC_POLE, GALACTIC_CENTRE } from "./stars.js";

const DEG = Math.PI / 180;
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Display radii in scene units. Neptune's orbit is 100 units; nothing here is to
// scale (Jupiter would be a speck), and the legend says so.
const BODY = {
    Mercury: { r: 0.70, style: 0, rotH: 1407.6 },
    Venus:   { r: 1.25, style: 1, rotH: 5832.5, atmo: [0.95, 0.86, 0.62, 2.0, 0.9] },
    Earth:   { r: 1.30, style: 2, rotH: 23.934, f: 0.00335, atmo: [0.32, 0.58, 1.0, 2.6, 1.4] },
    Mars:    { r: 0.95, style: 3, rotH: 24.623, f: 0.00589, atmo: [0.9, 0.55, 0.38, 3.5, 0.35] },
    Jupiter: { r: 3.00, style: 4, rotH: 9.925, f: 0.06487, atmo: [0.95, 0.85, 0.7, 3.0, 0.35] },
    Saturn:  { r: 2.50, style: 5, rotH: 10.656, f: 0.09796, atmo: [0.95, 0.85, 0.6, 3.0, 0.3], ring: 0 },
    Uranus:  { r: 1.85, style: 6, rotH: 17.24, f: 0.0229, atmo: [0.6, 0.9, 0.95, 2.4, 0.6], ring: 1 },
    Neptune: { r: 1.80, style: 7, rotH: 16.11, f: 0.0171, atmo: [0.4, 0.6, 1.0, 2.4, 0.6] },
};
const SUN = { r: 3.6, rotH: 609.12 };
const MOON = { r: 0.35, dist: 2.9 };
const TRUE_SIZE = 0.28;             // body sizes in true-scale mode, relative to the above
const TRUE_SUN = 0.7 / SUN.r;
// Standish Table 1: Jupiter's mean longitude at J2000 and its rate, for the trojans
const JUPITER = { a: 5.20288700, L0: 34.39644051 * DEG, n: 3034.74612775 / 36525 * DEG };

// ------------------------------------------------------------------ setup
const canvasHost = document.getElementById("scene");
const fail = (msg) => {
    document.getElementById("fallback").hidden = false;
    document.getElementById("fallback-detail").textContent = msg;
};

let renderer;
try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (e) {
    fail(String(e && e.message || e));
    throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x040405, 1);
canvasHost.appendChild(renderer.domElement);

// If the GPU process resets (driver hiccup, suspend/resume), three.js can pick
// up a restored context; if none comes back, reload and let QML re-push.
let contextTimer = null;
renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextTimer = setTimeout(() => location.reload(), 3000);
});
renderer.domElement.addEventListener("webglcontextrestored", () => {
    clearTimeout(contextTimer);
    bakeMilkyWay();            // render-target contents don't survive a context loss
    state.lastActivity = performance.now();
});

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = "labels";
canvasHost.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 6000);
camera.position.set(0, 160, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 1.1;
controls.screenSpacePanning = true;
controls.maxDistance = 1200;
controls.minDistance = 0.5;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------- state
const state = {
    trueScale: false,           // what the user picked
    accent: new THREE.Color("#c0392b"),
    data: null,                 // latest snapshot from Python
    orbits: null,
    selected: "",
    mode: "free",               // "free" | "earth"
    follow: "",                 // body the camera rides along with
    flight: null,
    lastActivity: performance.now(),
    dirty: true,                // something to draw even when idle
    lastRender: 0,
    placeName: "",
};
const effTrue = () => state.trueScale || state.mode === "earth";

// ---------------------------------------------------------------- the sky
// A group that rides along with the camera, so the stars are at infinity.
const sky = new THREE.Group();
sky.renderOrder = -10;
scene.add(sky);

const gy = cross(GALACTIC_POLE, GALACTIC_CENTRE);
// The Milky Way is a lot of noise per pixel, and it never changes, so it is
// painted once into an equirectangular texture laid out exactly like
// SphereGeometry's UVs, and the sky sphere just samples that.
const milkyWayTarget = new THREE.WebGLRenderTarget(2048, 1024, { type: THREE.HalfFloatType });
function bakeMilkyWay() {
    const mat = new THREE.ShaderMaterial({
        ...milkyWayShader,
        uniforms: {
            uGNP: { value: V3(eclToScene(GALACTIC_POLE)) },
            uGC: { value: V3(eclToScene(GALACTIC_CENTRE)) },
            uGY: { value: V3(eclToScene(gy)) },
            uStrength: { value: 1 },
        },
        depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const bakeScene = new THREE.Scene();
    bakeScene.add(quad);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(milkyWayTarget);
    renderer.render(bakeScene, new THREE.Camera());
    renderer.setRenderTarget(prev);
    quad.geometry.dispose();
    mat.dispose();
}
bakeMilkyWay();
const milkyWay = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.ShaderMaterial({
        uniforms: { uMap: { value: milkyWayTarget.texture }, uStrength: { value: 0.06 } },
        vertexShader: `varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D uMap; uniform float uStrength; varying vec2 vUv;
            void main() { gl_FragColor = vec4(texture2D(uMap, vUv).rgb * uStrength, 1.0); }`,
        side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
    }));
milkyWay.renderOrder = -10;
sky.add(milkyWay);

const field = makeStarfield(4500);
{
    const g = new THREE.BufferGeometry();
    const p = field.positions;
    const s = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
        const v = eclToScene([p[i], p[i + 1], p[i + 2]]);
        s[i] = v[0] * 0.98; s[i + 1] = v[1] * 0.98; s[i + 2] = v[2] * 0.98;
    }
    g.setAttribute("position", new THREE.BufferAttribute(s, 3));
    g.setAttribute("color", new THREE.BufferAttribute(field.colors, 3));
    g.setAttribute("mag", new THREE.BufferAttribute(field.mags, 1));
    var starMat = new THREE.ShaderMaterial({
        ...starShader,
        uniforms: { uPixelRatio: { value: renderer.getPixelRatio() }, uZoom: { value: 1 } },
        depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
    });
    const stars = new THREE.Points(g, starMat);
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    sky.add(stars);
}

// the ecliptic as a great circle on the sky, with the 13 zodiac constellations
const zodiacGroup = new THREE.Group();
sky.add(zodiacGroup);
function buildZodiac(zodiac, boundaries) {
    zodiacGroup.clear();
    const pts = [];
    for (let k = 0; k <= 360; k += 2) pts.push(V3(eclToScene(eclipticLonLat(k))).multiplyScalar(0.97));
    const ecl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false }));
    ecl.renderOrder = -8;
    zodiacGroup.add(ecl);
    const ticks = [];
    for (const b of boundaries) {
        ticks.push(V3(eclToScene(eclipticLonLat(b, -1.2))).multiplyScalar(0.97),
                   V3(eclToScene(eclipticLonLat(b, 1.2))).multiplyScalar(0.97));
    }
    const tk = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    tk.renderOrder = -8;
    zodiacGroup.add(tk);
    for (const z of zodiac) {
        const el = document.createElement("div");
        el.className = "zodiac";
        el.textContent = z.name.toUpperCase();
        const o = new CSS2DObject(el);
        o.position.copy(V3(eclToScene(eclipticLonLat(z.lon, -2.5))).multiplyScalar(0.97));
        zodiacGroup.add(o);
    }
    const eq = document.createElement("div");
    eq.className = "zodiac equinox";
    eq.textContent = "♈︎ equinox";
    const o = new CSS2DObject(eq);
    o.position.copy(V3(eclToScene(eclipticLonLat(0, 2.5))).multiplyScalar(0.97));
    zodiacGroup.add(o);
}

// ------------------------------------------------------------------- the Sun
function glowTexture(stops) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [t, col] of stops) grad.addColorStop(t, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const sunGroup = new THREE.Group();
scene.add(sunGroup);
const sunMat = new THREE.ShaderMaterial({ ...sunShader, uniforms: { uTime: { value: 0 } } });
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), sunMat);
sunGroup.add(sunMesh);
const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, "rgba(255,240,210,0.9)"], [0.12, "rgba(255,200,110,0.55)"],
                      [0.3, "rgba(255,120,40,0.16)"], [0.6, "rgba(200,30,30,0.04)"], [1, "rgba(0,0,0,0)"]]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
}));
scene.add(corona);

// ----------------------------------------------------------------- planets
const maskTex = new THREE.TextureLoader().load("earth-mask.png", () => { state.dirty = true; });
maskTex.colorSpace = THREE.NoColorSpace;
maskTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const sphereGeo = new THREE.SphereGeometry(1, 96, 64);
const bodies = {};        // name -> { anchor, frame, mesh, label, spec, pos }

function makeLabel(name, cls = "label") {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = name;
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => { e.stopPropagation(); pick(name); });
    return new CSS2DObject(el);
}

function planetMaterial(style, extra = {}) {
    return new THREE.ShaderMaterial({
        ...planetShader,
        uniforms: {
            uStyle: { value: style }, uTime: { value: 0 }, uMask: { value: maskTex },
            uHasRing: { value: false }, uRingCenter: { value: new THREE.Vector3() },
            uRingPole: { value: new THREE.Vector3(0, 1, 0) }, uRingRadius: { value: 1 },
            uLightOverride: { value: false }, uLightDir: { value: new THREE.Vector3(1, 0, 0) },
            ...extra,
        },
    });
}

function atmosphere(spec) {
    const [r, g, b, power, strength] = spec;
    const m = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({
        ...atmosphereShader,
        uniforms: { uColor: { value: new THREE.Color(r, g, b) }, uPower: { value: power }, uStrength: { value: strength } },
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    m.scale.setScalar(1.035);
    return m;
}

for (const [name, spec] of Object.entries(BODY)) {
    const anchor = new THREE.Group();          // position only (labels hang off this)
    const frame = new THREE.Group();           // + IAU orientation and display size
    anchor.add(frame);
    const mesh = new THREE.Mesh(sphereGeo, planetMaterial(spec.style));
    mesh.scale.set(1, 1 - (spec.f || 0), 1);   // oblate: local Y is the pole
    frame.add(mesh);
    if (spec.atmo) mesh.add(atmosphere(spec.atmo));
    if (spec.ring !== undefined) {
        const [r0, r1] = spec.ring === 0 ? [1.10, 2.34] : [1.62, 2.02];
        const g = new THREE.RingGeometry(r0, r1, 256, 1);
        g.rotateX(-Math.PI / 2);               // into the equatorial (local XZ) plane
        const ring = new THREE.Mesh(g, new THREE.ShaderMaterial({
            ...ringShader,
            uniforms: { uKind: { value: spec.ring }, uCenter: { value: new THREE.Vector3() },
                        uPole: { value: new THREE.Vector3(0, 1, 0) }, uRadius: { value: 1 } },
            side: THREE.DoubleSide, transparent: true, depthWrite: false,
        }));
        ring.renderOrder = 2;
        frame.add(ring);
        bodies[name] = { ring };
        if (spec.ring === 0) mesh.material.uniforms.uHasRing.value = true;
    }
    const label = makeLabel(name);
    anchor.add(label);
    scene.add(anchor);
    bodies[name] = { ...(bodies[name] || {}), anchor, frame, mesh, label, spec, pos: new THREE.Vector3() };
}

// Earth's companions: the Moon, and a pin for home
const moonMesh = new THREE.Mesh(sphereGeo, planetMaterial(8, { uLightOverride: { value: true } }));
scene.add(moonMesh);
const moonLabel = makeLabel("Moon", "label minor");
moonLabel.element.style.pointerEvents = "none";
moonMesh.add(moonLabel);

const pin = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,80,80,0.95)"], [1, "rgba(255,0,0,0)"]]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
}));
pin.scale.setScalar(0.13);
bodies.Earth.mesh.add(pin);
const pinLabel = new CSS2DObject(Object.assign(document.createElement("div"), { className: "label pin" }));
pin.add(pinLabel);

// selection marker: a crisp CSS ring, sized in pixels every frame
const marker = new CSS2DObject(Object.assign(document.createElement("div"), { className: "marker" }));
marker.visible = false;
scene.add(marker);

// Earth -> selected planet sight line
const sight = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.8 }));
sight.visible = false;
sight.frustumCulled = false;
scene.add(sight);

// "drop lines": from each planet down to the ecliptic plane, to read the 3D
const drops = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
drops.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(8 * 2 * 3), 3));
drops.frustumCulled = false;
scene.add(drops);

// -------------------------------------------------- asteroid belt + trojans
const beltData = [...makeBelt(7000), ...makeTrojans(2400, JUPITER)];
const beltGeo = new THREE.BufferGeometry();
{
    const el0 = new Float32Array(beltData.length * 4), el1 = new Float32Array(beltData.length * 3);
    beltData.forEach(([a, e, i, node, peri, M0, n], k) => {
        el0.set([a, e, i, node], k * 4);
        el1.set([peri, M0, n], k * 3);
    });
    beltGeo.setAttribute("el0", new THREE.BufferAttribute(el0, 4));
    beltGeo.setAttribute("el1", new THREE.BufferAttribute(el1, 3));
    // three needs a position attribute to know how many points to draw
    beltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(beltData.length * 3), 3));
}
const beltMat = new THREE.ShaderMaterial({
    ...beltShader,
    uniforms: { uDays: { value: 0 }, uTrue: { value: false }, uPixelRatio: { value: renderer.getPixelRatio() },
                uSize: { value: 0.09 }, uColor: { value: new THREE.Color(0.55, 0.5, 0.45) } },
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
});
const belt = new THREE.Points(beltGeo, beltMat);
belt.frustumCulled = false;
scene.add(belt);

// ------------------------------------------------------ orbits and the grid
const orbitLines = {};
const lineMats = [];
function lineMaterial(opacity) {
    const m = new LineMaterial({ linewidth: 1.3, vertexColors: true, transparent: true, opacity, depthWrite: false });
    m.resolution.set(window.innerWidth, window.innerHeight);
    lineMats.push(m);
    return m;
}

function buildOrbits() {
    if (!state.orbits) return;
    const tr = effTrue();
    for (const o of state.orbits) {
        const pos = [], col = [];
        for (const p of o.points) {
            const s = toScene(p, tr);
            pos.push(...s);
            const k = p[2] >= 0 ? 1 : 0.4;        // the stretch below the ecliptic is dimmer
            col.push(k, k, k);
        }
        let line = orbitLines[o.name];
        if (!line) {
            line = new Line2(new LineGeometry(), lineMaterial(0.3));
            line.renderOrder = 1;
            scene.add(line);
            orbitLines[o.name] = line;
        }
        line.geometry.dispose();
        line.geometry = new LineGeometry();
        line.geometry.setPositions(pos);
        line.geometry.setColors(col);
        line.computeLineDistances();
    }
    styleOrbits();
    buildGrid();
}

function styleOrbits() {
    // from Earth we are inside the orbits' plane, so they are only a faint guide
    const k = state.mode === "earth" ? 0.35 : 1;
    for (const [name, line] of Object.entries(orbitLines)) {
        const m = line.material;
        if (name === state.selected) { m.color.copy(state.accent); m.opacity = 0.95 * k; m.linewidth = 2; }
        else if (name === "Earth") { m.color.setRGB(0.4, 0.62, 1.0); m.opacity = 0.55 * k; m.linewidth = 1.4; }
        else { m.color.setRGB(1, 1, 1); m.opacity = 0.22 * k; m.linewidth = 1.2; }
        line.visible = !(state.mode === "earth" && name === "Earth");
    }
    grid.visible = state.mode !== "earth";
}

const grid = new THREE.Group();
scene.add(grid);
function buildGrid() {
    grid.traverse(o => { if (o.isCSS2DObject) o.element.remove(); });
    grid.clear();
    const tr = effTrue();
    // A distance ruler in the ecliptic plane along longitude 300 deg (rings would
    // sit right on top of the orbits): a line out to Neptune with AU ticks.
    const dir = new THREE.Vector3(Math.cos(-60 * DEG), 0, -Math.sin(-60 * DEG));
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const pts = [new THREE.Vector3(), dir.clone().multiplyScalar(radial(30, tr))];
    const ticks = tr ? [1, 5, 10, 20, 30] : [0.5, 1, 2, 5, 10, 20, 30];
    for (const au of ticks) {
        const p = dir.clone().multiplyScalar(radial(au, tr));
        pts.push(p.clone().addScaledVector(side, -0.8), p.clone().addScaledVector(side, 0.8));
        const el = document.createElement("div");
        el.className = "grid";
        el.textContent = `${au} AU`;
        const o = new CSS2DObject(el);
        o.position.copy(p).addScaledVector(side, 2.2);
        grid.add(o);
    }
    grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(
        [pts[0], pts[1], ...pts.slice(2)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false })));
    // the March equinox direction (ecliptic longitude 0), beyond Neptune
    const r0 = radial(30, tr) + 3, r1 = radial(30, tr) + 11;
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(r0, 0, 0), new THREE.Vector3(r1, 0, 0)]),
        new THREE.LineBasicMaterial({ color: state.accent, transparent: true, opacity: 0.55 })));
    const eq = document.createElement("div");
    eq.className = "grid equinox";
    eq.textContent = "♈︎ lon 0°";
    const eo = new CSS2DObject(eq);
    eo.position.set(r1 + 3, 0, 0);
    grid.add(eo);
}

// ------------------------------------------------------------- the bridge
let bridge = null;
if (window.qt && window.qt.webChannelTransport && window.QWebChannel) {
    new window.QWebChannel(window.qt.webChannelTransport, (ch) => { bridge = ch.objects.bridge; });
}
function pick(name) {
    if (name && !BODY[name]) return;           // the Sun and the Moon have no info card
    if (bridge) bridge.pick(name || "");
    else window.dispatchEvent(new CustomEvent("orrery-pick", { detail: name || "" }));
}

// --------------------------------------------------------------- updates
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const basis = new THREE.Matrix4();

function orient(obj, pole, pm) {
    const b = bodyBasis(eclToScene(pole), eclToScene(pm));
    basis.makeBasis(V3(b.x), V3(b.y), V3(b.z));
    obj.quaternion.setFromRotationMatrix(basis);
}

function applySnapshot() {
    const d = state.data;
    if (!d) return;
    const tr = effTrue();
    const k = tr ? TRUE_SIZE : 1;
    // above ~1.5 turns a second a spinning globe is a strobe, not information
    const spinOK = (hours) => Math.abs(d.speed) / 3600 / hours < 1.5;

    const sunR = SUN.r * (tr ? TRUE_SUN : 1);
    sunGroup.scale.setScalar(sunR);
    if (spinOK(SUN.rotH)) orient(sunMesh, d.sun.pole, d.sun.pm);
    corona.scale.setScalar(sunR * 9);

    d.bodies.forEach((b) => {
        const body = bodies[b.name];
        if (!body) return;
        body.pos.set(...toScene(b.pos, tr));
        body.anchor.position.copy(body.pos);
        const r = body.spec.r * k;
        body.frame.scale.setScalar(r);
        body.radius = r;
        if (spinOK(body.spec.rotH)) orient(body.frame, b.pole, b.pm);
        const text = b.name + (b.up ? " ▴" : "");
        if (body.label.element.textContent !== text) body.label.element.textContent = text;
        body.label.element.classList.toggle("up", !!b.up);
    });

    // the Moon: true direction from Earth, at a made-up distance
    const earth = bodies.Earth;
    const mdir = V3(eclToScene(d.moon)).normalize();
    const moonDist = MOON.dist * k * (tr ? 1.6 : 1);
    moonMesh.position.copy(earth.pos).addScaledVector(mdir, moonDist);
    moonMesh.scale.setScalar(MOON.r * k);

    // Standing on Earth, "exaggerated" globes would be degrees across and hide
    // each other, so give everything a fixed small size on the sky instead:
    // about 0.7 deg for the planets and the Moon's real 0.5 deg.
    if (state.mode === "earth") {
        for (const body of Object.values(bodies)) {
            if (body === earth) continue;
            body.radius = earth.pos.distanceTo(body.pos) * 0.006;
            body.frame.scale.setScalar(body.radius);
        }
        moonMesh.scale.setScalar(moonDist * Math.tan(0.26 * DEG));
    }
    moonMesh.lookAt(earth.pos);   // tidally locked: local +Z (the near side) faces Earth
    // lit as it is from Earth's distance from the Sun, so its phase is the real one
    moonMesh.material.uniforms.uLightDir.value.copy(earth.pos).negate().normalize();

    // home
    const lat = d.place.lat * DEG, lon = d.place.lon * DEG;
    pin.position.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(1.01);
    pinLabel.element.textContent = d.place.name;

    beltMat.uniforms.uDays.value = d.days;
    beltMat.uniforms.uTrue.value = tr;

    for (const [name, body] of Object.entries(bodies)) {
        if (!body.ring) continue;
        const u = body.ring.material.uniforms;
        u.uCenter.value.copy(body.pos);
        u.uPole.value.set(0, 1, 0).applyQuaternion(body.frame.quaternion);
        u.uRadius.value = body.radius;
        if (name === "Saturn") {
            const pu = body.mesh.material.uniforms;
            pu.uRingCenter.value.copy(body.pos);
            pu.uRingPole.value.copy(u.uPole.value);
            pu.uRingRadius.value = body.radius;
        }
    }

    if (d.selected !== state.selected) selectionChanged(d.selected);
    updateSelectionVisuals();
}

function updateSelectionVisuals() {
    const sel = bodies[state.selected];
    marker.visible = !!sel && state.mode !== "earth";
    if (sel) marker.position.copy(sel.pos);
    const showSight = !!sel && state.selected !== "Earth" && state.mode !== "earth";
    sight.visible = showSight;
    if (showSight) {
        const a = sight.geometry.attributes.position.array;
        const e = bodies.Earth.pos, s = sel.pos;
        a.set([e.x, e.y, e.z, s.x, s.y, s.z]);
        sight.geometry.attributes.position.needsUpdate = true;
        sight.geometry.computeBoundingSphere();
        sight.computeLineDistances();
        sight.material.color.copy(state.accent);
    }
    for (const [name, b] of Object.entries(bodies)) b.label.element.classList.toggle("selected", name === state.selected);
}

function selectionChanged(name) {
    state.selected = name || "";
    styleOrbits();
    if (state.mode === "earth") { aimFromEarth(true); return; }
    if (state.selected) flyTo(state.selected);
    else flyHome();
}

// ------------------------------------------------------------------ camera
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Fly so the camera ends `dist` from `name` (or from the origin), keeping
// (or setting) the viewing direction. The target is re-read every frame, so a
// planet that keeps moving is still met where it is.
function flyTo(name, opts = {}) {
    const body = bodies[name];
    if (!body) return;
    const dir = opts.dir || camera.position.clone().sub(controls.target).normalize();
    state.flight = {
        t0: performance.now(), dur: opts.dur || 1400,
        fromTarget: controls.target.clone(), fromPos: camera.position.clone(),
        target: () => body.pos, dist: opts.dist || body.radius * (name === "Saturn" ? 9 : 7), dir,
        follow: name,
    };
    state.follow = "";
    controls.enabled = false;
}

function presetDir(preset) {
    // theta = 0 keeps the March equinox to the right, like the 2D map
    const phi = { overview: 56, top: 0.05, edge: 88.5 }[preset] * DEG;
    return new THREE.Vector3(0, Math.cos(phi), Math.sin(phi));
}

function flyHome(preset = "overview") {
    state.flight = {
        t0: performance.now(), dur: 1500,
        fromTarget: controls.target.clone(), fromPos: camera.position.clone(),
        target: () => new THREE.Vector3(), dist: 210, dir: presetDir(preset), follow: "",
    };
    state.follow = "";
    controls.enabled = false;
}

function stepFlight(now) {
    const f = state.flight;
    if (!f) return false;
    const t = Math.min(1, (now - f.t0) / f.dur), e = ease(t);
    const goal = f.target().clone();
    controls.target.lerpVectors(f.fromTarget, goal, e);
    const endPos = goal.clone().addScaledVector(f.dir, f.dist);
    // travel along an arc in distance-from-target rather than a straight chord,
    // so the camera doesn't plough through the Sun
    const fromOff = f.fromPos.clone().sub(f.fromTarget);
    const toOff = endPos.clone().sub(goal);
    const len = THREE.MathUtils.lerp(fromOff.length(), toOff.length(), e);
    const off = fromOff.normalize().lerp(toOff.normalize(), e).normalize().multiplyScalar(len);
    camera.position.copy(controls.target).add(off);
    camera.lookAt(controls.target);
    if (t >= 1) {
        state.flight = null;
        state.follow = f.follow;
        controls.enabled = state.mode !== "earth";
        lastFollowPos.copy(goal);
    }
    return true;
}

const lastFollowPos = new THREE.Vector3();
function stepFollow() {
    const body = bodies[state.follow];
    if (!body || state.flight) return;
    tmp.copy(body.pos).sub(lastFollowPos);
    if (tmp.lengthSq() > 0) {
        camera.position.add(tmp);
        controls.target.add(tmp);
    }
    lastFollowPos.copy(body.pos);
    controls.minDistance = body.radius * 1.6;
}

// --- the view from Earth: camera at Earth, looking along true directions
const earthLook = { dir: new THREE.Vector3(1, 0, 0), goal: null, fov: 50 };
function enterEarthMode() {
    state.mode = "earth";
    state.flight = null;
    state.follow = "";
    controls.enabled = false;
    rebuildForScale();
    aimFromEarth(false);
}
function leaveEarthMode() {
    if (state.mode !== "earth") return;
    state.mode = "free";
    camera.up.set(0, 1, 0);
    camera.fov = 42;
    camera.updateProjectionMatrix();
    bodies.Earth.frame.visible = true;
    controls.enabled = true;
    rebuildForScale();
}
function aimFromEarth(animate) {
    const sel = bodies[state.selected];
    const e = bodies.Earth.pos;
    // no target: look away from the Sun, at the midnight sky
    const goal = sel && state.selected !== "Earth" ? sel.pos.clone().sub(e).normalize() : e.clone().normalize();
    if (animate) earthLook.goal = goal; else { earthLook.dir.copy(goal); earthLook.goal = null; }
}
function stepEarthCamera() {
    const d = state.data;
    if (!d) return;
    const e = bodies.Earth.pos;
    bodies.Earth.frame.visible = false;
    if (earthLook.goal) {
        earthLook.dir.lerp(earthLook.goal, 0.08).normalize();
        if (earthLook.dir.angleTo(earthLook.goal) < 0.002) earthLook.goal = null;
    }
    // northern-hemisphere habit: Earth's own north pole is "up"
    const earthData = d.bodies.find(b => b.name === "Earth");
    camera.up.copy(V3(eclToScene(earthData.pole)));
    camera.position.copy(e);
    camera.lookAt(tmp.copy(e).add(earthLook.dir));
    if (Math.abs(camera.fov - earthLook.fov) > 0.01) {
        camera.fov = earthLook.fov;
        camera.updateProjectionMatrix();
    }
}

// --- input (orbit controls do the free camera; these are the extras)
let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, moved: false };
    state.lastActivity = performance.now();
    if (state.flight && state.mode !== "earth") {       // grab the camera back mid-flight
        state.flight = null;
        controls.enabled = true;
    }
});
renderer.domElement.addEventListener("pointermove", (e) => {
    state.lastActivity = performance.now();
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
    if (state.mode === "earth" && down.moved && e.buttons) {
        // look around: yaw about Earth's pole, pitch about the camera's right
        const k = camera.fov / window.innerHeight * DEG;
        const up = camera.up.clone();
        const right = earthLook.dir.clone().cross(up).normalize();
        earthLook.dir.applyAxisAngle(up, dx * k).applyAxisAngle(right, dy * k).normalize();
        if (Math.abs(earthLook.dir.dot(up)) > 0.995) earthLook.dir.applyAxisAngle(right, -dy * k);
        earthLook.goal = null;
        down.x = e.clientX; down.y = e.clientY;
    }
});
renderer.domElement.addEventListener("pointerup", (e) => {
    const wasClick = down && !down.moved && e.button === 0;
    down = null;
    if (!wasClick) return;
    // nearest body on screen within a forgiving radius, like the 2D map
    let best = "", bestD = Infinity;
    const w = window.innerWidth, h = window.innerHeight;
    for (const [name, b] of Object.entries(bodies)) {
        if (state.mode === "earth" && name === "Earth") continue;
        tmp.copy(b.pos).project(camera);
        if (tmp.z > 1) continue;
        const sx = (tmp.x + 1) / 2 * w, sy = (1 - tmp.y) / 2 * h;
        const pr = projectedRadius(b.pos, b.radius);
        const dd = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (dd < Math.max(22, pr * 1.3) && dd < bestD) { best = name; bestD = dd; }
    }
    if (best) pick(best);
    else if (state.selected) pick(state.selected);       // click on empty space clears
});
// (the two clicks before a double-click have already toggled any selection
// on and off again, so this only has to move the camera)
renderer.domElement.addEventListener("dblclick", () => {
    if (state.mode === "earth") { earthLook.fov = 50; aimFromEarth(true); return; }
    flyHome();
});
renderer.domElement.addEventListener("wheel", (e) => {
    state.lastActivity = performance.now();
    if (state.mode !== "earth") return;
    earthLook.fov = THREE.MathUtils.clamp(earthLook.fov * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 4, 100);
}, { passive: true });
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

// ------------------------------------------------------------------ legend
const legend = document.getElementById("legend");
function updateLegend() {
    const parts = [];
    if (state.mode === "earth") {
        parts.push("from Earth · true directions against the real stars · discs enlarged to ~0.7°",
                   "drag to look around · wheel to zoom · double-click to re-aim");
    } else {
        parts.push(effTrue() ? "true scale distances" : "distances log-compressed",
                   "sizes exaggerated",
                   "belt & trojans illustrative",
                   "click a planet · drag to orbit · right-drag to pan · wheel to zoom · double-click to reset",
                   "▴ above your horizon now");
    }
    legend.textContent = parts.join("  ·  ");
}

// ------------------------------------------------------------------- loop
const timer = new THREE.Timer();
function rebuildForScale() {
    buildOrbits();
    applySnapshot();
    updateLegend();
    if (state.selected && state.mode !== "earth") flyTo(state.selected, { dur: 900 });
}

// pixels across for a sphere of radius r at p
function projectedRadius(p, r) {
    const dist = Math.max(camera.position.distanceTo(p), 1e-6);
    return r / dist / Math.tan(camera.fov * DEG / 2) * window.innerHeight / 2;
}

function updateDrops() {
    const a = drops.geometry.attributes.position.array;
    Object.values(bodies).forEach((b, i) => {
        // collapsed to nothing for a body we're up close to
        const y0 = camera.position.distanceTo(b.pos) < b.radius * 25 ? b.pos.y : 0;
        a.set([b.pos.x, b.pos.y, b.pos.z, b.pos.x, y0, b.pos.z], i * 6);
    });
    drops.geometry.attributes.position.needsUpdate = true;
    drops.visible = state.mode !== "earth";
}

function nearestSurface() {
    let dmin = camera.position.length() - sunGroup.scale.x;
    for (const b of Object.values(bodies)) {
        if (!b.frame.visible) continue;          // Earth, while we are standing on it
        const d = camera.position.distanceTo(b.pos) - b.radius * 2.4;
        if (d < dmin) dmin = d;
    }
    dmin = Math.min(dmin, camera.position.distanceTo(moonMesh.position) - moonMesh.scale.x);
    return Math.max(dmin, 0.0005);
}

function frame(now) {
    requestAnimationFrame(frame);
    const busy = state.flight || earthLook.goal || now - state.lastActivity < 2500;
    // Idle (a desk orrery left open on live time): draw only when something
    // changed, which in live mode is once a second. Any interaction or playback
    // brings back the full frame rate, the Sun's boiling surface included.
    if (!busy && !state.dirty && now - state.lastRender < 5000) return;
    state.dirty = false;
    state.lastRender = now;

    timer.update(now);
    const t = timer.getElapsed();
    sunMat.uniforms.uTime.value = t;
    for (const b of Object.values(bodies)) b.mesh.material.uniforms.uTime.value = t;

    if (state.mode === "earth") stepEarthCamera();
    else {
        stepFlight(now);
        stepFollow();
        if (!state.follow && !state.flight) controls.minDistance = 0.5;
        if (controls.enabled) controls.update();
    }

    // clip planes hug what is near, so close-ups and the far planets both work
    const near = THREE.MathUtils.clamp(nearestSurface() * 0.4, 0.002, 2);
    const far = Math.max(3000, camera.position.length() * 4);
    if (near !== camera.near || far !== camera.far) {
        camera.near = near; camera.far = far;
        camera.updateProjectionMatrix();
    }
    sky.position.copy(camera.position);
    sky.scale.setScalar(far * 0.8);
    starMat.uniforms.uZoom.value = THREE.MathUtils.clamp(Math.sqrt(42 / camera.fov), 1, 2.2);

    // labels sit just above each globe (plus ~11 px), whichever way the camera is turned
    const up = tmp2.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const pxPerUnitAt1 = window.innerHeight / (2 * Math.tan(camera.fov * DEG / 2));
    for (const b of Object.values(bodies)) {
        const dist = camera.position.distanceTo(b.pos);
        const lift = b.radius * (b.spec.ring === 0 ? 1.6 : 1.1) + 11 * dist / pxPerUnitAt1;
        b.label.position.copy(up).multiplyScalar(lift);
        b.label.element.style.opacity = dist < b.radius * 2.2 ? "0" : "";
    }
    updateDrops();
    if (marker.visible) {
        const sel = bodies[state.selected];
        const px = projectedRadius(sel.pos, sel.radius * (state.selected === "Saturn" ? 2.4 : 1.15));
        const size = Math.round(Math.max(22, 2 * px + 12));
        marker.element.style.width = marker.element.style.height = size + "px";
    }
    const earthDist = camera.position.distanceTo(bodies.Earth.pos);
    // (CSS2DRenderer owns style.display, so hide through .visible)
    moonLabel.visible = earthDist < 16 && state.mode !== "earth";
    moonLabel.position.copy(up).multiplyScalar(1.6);
    pinLabel.visible = earthDist < bodies.Earth.radius * 14 && state.mode !== "earth";
    corona.material.opacity = state.mode === "earth" ? 0.7 : 1;

    composer.render();
    labelRenderer.render(scene, camera);
    state.frames = (state.frames || 0) + 1;
}

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    labelRenderer.setSize(w, h);
    for (const m of lineMats) m.resolution.set(w, h);
    state.dirty = true;
    state.lastActivity = performance.now();
}
window.addEventListener("resize", resize);

// ---------------------------------------------------------- public API (QML)
window.orrery = {
    setStatic(s) {
        buildZodiac(s.zodiac, s.boundaries);
        state.dirty = true;
    },
    setOrbits(orbits) {
        state.orbits = orbits;
        buildOrbits();
        state.dirty = true;
    },
    update(data) {
        const first = !state.data;
        state.data = data;
        if (first) {                       // start at the overview, no flight
            camera.position.copy(presetDir("overview")).multiplyScalar(210);
            controls.target.set(0, 0, 0);
            camera.lookAt(controls.target);
        }
        applySnapshot();
        state.dirty = true;
        if (data.speed !== 0 && !data.live) state.lastActivity = performance.now();
    },
    setOptions(o) {
        if (o.accent) {
            state.accent.set(o.accent);
            document.documentElement.style.setProperty("--accent", o.accent);
        }
        if (o.trueScale !== undefined && o.trueScale !== state.trueScale) {
            state.trueScale = !!o.trueScale;
            rebuildForScale();
        }
        styleOrbits();
        buildGrid();
        updateSelectionVisuals();
        updateLegend();
        state.lastActivity = performance.now();
    },
    camera(preset) {
        state.lastActivity = performance.now();
        if (preset === "earth") { if (state.mode !== "earth") enterEarthMode(); else aimFromEarth(true); updateLegend(); return; }
        leaveEarthMode();
        flyHome(preset);
        updateLegend();
    },
    // for tests and screenshots
    _debug: { state, camera, controls, bodies, renderer, milkyWay, bloom, belt },
};

updateLegend();
requestAnimationFrame(frame);
document.documentElement.dataset.ready = "1";
