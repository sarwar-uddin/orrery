import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

// Top-down view of the solar system from the north ecliptic pole.
// Ecliptic longitude 0 (the March equinox direction) points right and
// longitude increases counter-clockwise, as it does in the real sky map.
Item {
    id: root
    required property var sky
    property bool trueScale: false
    property real zoom: 1.0
    property real panX: 0
    property real panY: 0
    readonly property color accent: Kirigami.Theme.highlightColor

    readonly property real ringR: Math.min(width, height) / 2 - 34
    readonly property real cx: width / 2 + panX
    readonly property real cy: height / 2 + panY
    readonly property real neptuneA: 30.07

    // AU distance -> pixels. Compressed mode is logarithmic, log(1 + r/k), so the
    // crowded inner system gets room and Neptune still fits; true scale is linear
    // (zoom in to find Earth).
    readonly property real logK: 0.35
    function radius(r) {
        const outer = (ringR - 22) * zoom
        return trueScale ? r / neptuneA * outer
                         : Math.log(1 + r / logK) / Math.log(1 + neptuneA / logK) * outer
    }
    function toScreen(x, y) {
        const r = Math.hypot(x, y)
        if (r === 0) return Qt.point(cx, cy)
        const k = radius(r) / r
        return Qt.point(cx + x * k, cy - y * k)
    }

    onTrueScaleChanged: { orbitLayer.requestPaint(); bodyLayer.requestPaint() }
    onZoomChanged: { orbitLayer.requestPaint(); bodyLayer.requestPaint() }
    onPanXChanged: { orbitLayer.requestPaint(); bodyLayer.requestPaint() }
    onPanYChanged: { orbitLayer.requestPaint(); bodyLayer.requestPaint() }
    onWidthChanged: { stars.requestPaint(); orbitLayer.requestPaint(); bodyLayer.requestPaint() }
    onHeightChanged: { stars.requestPaint(); orbitLayer.requestPaint(); bodyLayer.requestPaint() }

    // hidden behind the 3D view: don't paint at all, catch up when shown
    onVisibleChanged: if (visible) { stars.requestPaint(); orbitLayer.requestPaint(); bodyLayer.requestPaint() }

    Connections {
        target: root.sky
        enabled: root.visible
        function onBodiesChanged() { bodyLayer.requestPaint() }
        function onOrbitsChanged() { orbitLayer.requestPaint() }
        function onSelectionChanged() { bodyLayer.requestPaint() }
    }

    // deep space
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#0b0b0e" }
            GradientStop { position: 0.55; color: "#050506" }
            GradientStop { position: 1.0; color: "#100406" }
        }
    }

    Canvas {
        id: stars
        anchors.fill: parent
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            let seed = 1337
            const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
            const n = Math.round(width * height / 2600)
            for (let i = 0; i < n; i++) {
                const x = rnd() * width, y = rnd() * height
                const b = Math.pow(rnd(), 3)
                const warm = rnd() < 0.15
                ctx.fillStyle = warm ? Qt.rgba(1, 0.75, 0.7, 0.25 + 0.6 * b)
                                     : Qt.rgba(0.85, 0.88, 1, 0.2 + 0.7 * b)
                const s = 0.5 + b * 1.4
                ctx.fillRect(x, y, s, s)
            }
        }
    }

    // orbits + the zodiac ring (only changes on resize/zoom/every few years)
    Canvas {
        id: orbitLayer
        anchors.fill: parent
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            const sky = root.sky

            // zodiac ring: fixed, shows which constellation lies behind each planet
            const R = root.ringR
            const ccx = width / 2, ccy = height / 2
            ctx.lineWidth = 1
            ctx.strokeStyle = Qt.rgba(1, 1, 1, 0.10)
            ctx.beginPath(); ctx.arc(ccx, ccy, R, 0, 2 * Math.PI); ctx.stroke()
            ctx.strokeStyle = Qt.rgba(1, 1, 1, 0.05)
            ctx.beginPath(); ctx.arc(ccx, ccy, R + 22, 0, 2 * Math.PI); ctx.stroke()
            ctx.strokeStyle = Qt.rgba(1, 1, 1, 0.12)
            for (const b of sky.zodiacBoundaries) {
                const a = -b * Math.PI / 180
                ctx.beginPath()
                ctx.moveTo(ccx + Math.cos(a) * R, ccy + Math.sin(a) * R)
                ctx.lineTo(ccx + Math.cos(a) * (R + 22), ccy + Math.sin(a) * (R + 22))
                ctx.stroke()
            }
            ctx.font = "9px 'JetBrains Mono'"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillStyle = Qt.rgba(1, 1, 1, 0.38)
            for (const z of sky.zodiac) {
                const a = -z.lon * Math.PI / 180
                const rr = R + 11
                ctx.save()
                ctx.translate(ccx + Math.cos(a) * rr, ccy + Math.sin(a) * rr)
                let rot = a + Math.PI / 2
                if (Math.sin(a) > 0) rot += Math.PI   // keep bottom labels upright
                ctx.rotate(rot)
                ctx.fillText(z.name.toUpperCase(), 0, 0)
                ctx.restore()
            }
            // March equinox marker
            ctx.fillStyle = Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.8)
            ctx.beginPath()
            ctx.moveTo(ccx + R - 6, ccy); ctx.lineTo(ccx + R + 1, ccy - 4); ctx.lineTo(ccx + R + 1, ccy + 4)
            ctx.closePath(); ctx.fill()

            // orbits, clipped to the ring
            ctx.save()
            ctx.beginPath(); ctx.arc(ccx, ccy, R - 1, 0, 2 * Math.PI); ctx.clip()
            for (const o of sky.orbits) {
                const earth = o.name === "Earth"
                ctx.strokeStyle = earth ? Qt.rgba(0.35, 0.55, 0.9, 0.45)
                                        : (o.name === sky.selected ? Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.7)
                                                                   : Qt.rgba(1, 1, 1, 0.13))
                ctx.lineWidth = earth ? 1.2 : 1
                ctx.beginPath()
                o.points.forEach((p, i) => {
                    const s = root.toScreen(p[0], p[1])
                    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y)
                })
                ctx.stroke()
            }
            ctx.restore()
        }
    }

    // sun + planets: repainted every frame of the simulation
    Canvas {
        id: bodyLayer
        anchors.fill: parent
        renderStrategy: Canvas.Cooperative

        function glossyBall(ctx, x, y, r, color, sunAngle) {
            // lit hemisphere faces the Sun; a glassy highlight sits on top (Oxygen-style)
            const lx = x - Math.cos(sunAngle) * r * 0.45
            const ly = y - Math.sin(sunAngle) * r * 0.45
            const g = ctx.createRadialGradient(lx, ly, r * 0.1, x, y, r * 1.05)
            g.addColorStop(0, Qt.lighter(color, 1.45))
            g.addColorStop(0.45, color)
            g.addColorStop(1, Qt.darker(color, 4.5))
            ctx.fillStyle = g
            ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
            // gloss cap
            const gg = ctx.createLinearGradient(x, y - r, x, y)
            gg.addColorStop(0, Qt.rgba(1, 1, 1, 0.55))
            gg.addColorStop(1, Qt.rgba(1, 1, 1, 0.0))
            ctx.fillStyle = gg
            ctx.beginPath()
            ctx.ellipse(x - r * 0.62, y - r * 0.9, r * 1.24, r * 0.95)
            ctx.fill()
            // thin rim
            ctx.strokeStyle = Qt.rgba(0, 0, 0, 0.5)
            ctx.lineWidth = 0.6
            ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke()
        }

        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            const sky = root.sky
            const cx = root.cx, cy = root.cy

            ctx.save()
            ctx.beginPath(); ctx.arc(width / 2, height / 2, root.ringR - 1, 0, 2 * Math.PI); ctx.clip()

            // the Sun
            const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 46)
            glow.addColorStop(0, Qt.rgba(1, 0.95, 0.8, 1))
            glow.addColorStop(0.18, Qt.rgba(1, 0.78, 0.35, 0.95))
            glow.addColorStop(0.4, Qt.rgba(1, 0.45, 0.12, 0.35))
            glow.addColorStop(1, Qt.rgba(0.8, 0.06, 0.1, 0))
            ctx.fillStyle = glow
            ctx.beginPath(); ctx.arc(cx, cy, 46, 0, 2 * Math.PI); ctx.fill()

            let earthPos = null
            const pos = {}
            for (const b of sky.bodies) {
                const p = root.toScreen(b.x, b.y)
                pos[b.name] = p
                if (b.name === "Earth") earthPos = p
            }

            // Earth -> selected planet sight line
            if (sky.selected && sky.selected !== "Earth" && earthPos && pos[sky.selected]) {
                const t = pos[sky.selected]
                ctx.setLineDash([4, 4])
                ctx.strokeStyle = Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.75)
                ctx.lineWidth = 1
                ctx.beginPath(); ctx.moveTo(earthPos.x, earthPos.y); ctx.lineTo(t.x, t.y); ctx.stroke()
                ctx.setLineDash([])
            }

            ctx.font = "10px 'Oxygen', sans-serif"
            ctx.textBaseline = "middle"
            // label obstacles: every planet disc, then each label as it is placed
            const placed = sky.bodies.map(b => {
                const p = pos[b.name], rr = b.size * 1.6 + 3
                return { x0: p.x - rr, x1: p.x + rr, y: p.y, h: rr }
            })
            for (const b of sky.bodies) {
                const p = pos[b.name]
                const r = b.size * Math.max(0.8, Math.min(1.6, Math.sqrt(root.zoom)))
                const sunAngle = Math.atan2(p.y - cy, p.x - cx)

                if (b.name === "Saturn") {
                    ctx.strokeStyle = Qt.rgba(0.9, 0.82, 0.6, 0.75)
                    ctx.lineWidth = 1.6
                    ctx.beginPath(); ctx.ellipse(p.x - r * 2.1, p.y - r * 0.65, r * 4.2, r * 1.3); ctx.stroke()
                }
                glossyBall(ctx, p.x, p.y, r, b.color, sunAngle)

                if (b.name === "Earth") {
                    // the Moon, in its true direction, at a not-at-all-true distance
                    const a = -b.moonLon * Math.PI / 180
                    const mx = p.x + Math.cos(a) * (r + 7), my = p.y + Math.sin(a) * (r + 7)
                    glossyBall(ctx, mx, my, 2.2, "#d8d8d0", Math.atan2(my - cy, mx - cx))
                }
                if (b.name === sky.selected) {
                    ctx.strokeStyle = root.accent
                    ctx.lineWidth = 1.5
                    ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI); ctx.stroke()
                }
                const up = b.alt !== undefined && b.alt > 0
                ctx.fillStyle = b.name === sky.selected ? Qt.lighter(root.accent, 1.3)
                                : (up ? Qt.rgba(1, 1, 1, 0.85) : Qt.rgba(1, 1, 1, 0.45))
                // label on the side facing the middle of the view, so the outer
                // planets never push their names into the zodiac ring
                const inward = p.x > width / 2 + 40
                const label = b.name + (up ? " ▴" : "")
                const w = ctx.measureText(label).width
                const lx = p.x + (inward ? -(r + 6) : r + 6)
                // try above, then below, then further out until it doesn't hit another label
                let ly = p.y - r - 3
                for (const dy of [0, 2 * r + 6, -13, 2 * r + 19, -26, 2 * r + 32]) {
                    const y = p.y - r - 3 + dy
                    const x0 = inward ? lx - w : lx
                    if (!placed.some(q => x0 < q.x1 && x0 + w > q.x0 && Math.abs(y - q.y) < 6 + q.h)) {
                        ly = y
                        placed.push({ x0: x0, x1: x0 + w, y: y, h: 6 })
                        break
                    }
                }
                ctx.textAlign = inward ? "right" : "left"
                ctx.fillText(label, lx, ly)
            }
            ctx.restore()
        }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton
        property point last
        property bool dragged: false
        cursorShape: pressed && dragged ? Qt.ClosedHandCursor : Qt.ArrowCursor

        onPressed: (e) => { last = Qt.point(e.x, e.y); dragged = false }
        onPositionChanged: (e) => {
            const dx = e.x - last.x, dy = e.y - last.y
            if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true
            if (dragged) { root.panX += dx; root.panY += dy; last = Qt.point(e.x, e.y) }
        }
        onClicked: (e) => {
            if (dragged) return
            let best = "", bestD = 22
            for (const b of root.sky.bodies) {
                const p = root.toScreen(b.x, b.y)
                const d = Math.hypot(p.x - e.x, p.y - e.y)
                if (d < bestD) { bestD = d; best = b.name }
            }
            if (best) root.sky.select(best)
            else if (root.sky.selected) root.sky.select(root.sky.selected)
        }
        onDoubleClicked: { root.zoom = 1; root.panX = 0; root.panY = 0 }
        onWheel: (w) => {
            const f = w.angleDelta.y > 0 ? 1.15 : 1 / 1.15
            const nz = Math.max(0.5, Math.min(root.trueScale ? 60 : 8, root.zoom * f))
            // zoom around the cursor
            const k = nz / root.zoom
            root.panX = (root.panX + width / 2 - w.x) * k - width / 2 + w.x
            root.panY = (root.panY + height / 2 - w.y) * k - height / 2 + w.y
            root.zoom = nz
        }
    }

    // legend / hints
    QQC2.Label {
        anchors { left: parent.left; bottom: parent.bottom; margins: Kirigami.Units.largeSpacing }
        color: Qt.rgba(1, 1, 1, 0.4)
        font.pointSize: Kirigami.Theme.smallFont.pointSize
        text: (root.trueScale ? "true scale" : "distances log-compressed")
              + (root.zoom !== 1 ? ` · ${root.zoom.toFixed(1)}×` : "")
              + "  ·  click a planet  ·  wheel to zoom, drag to pan, double-click to reset  ·  ▴ above the horizon now"
    }
}
