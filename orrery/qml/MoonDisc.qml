import QtQuick

// The Moon's lit fraction drawn as a disc: half-disc on the lit side,
// with a terminator ellipse either eating into it (crescent) or adding to it (gibbous).
Canvas {
    id: disc
    property real illumination: 0.5
    property bool waxing: true
    implicitWidth: 76
    implicitHeight: 76
    onIlluminationChanged: requestPaint()
    onWaxingChanged: requestPaint()

    onPaint: {
        const ctx = getContext("2d")
        ctx.reset()
        const r = Math.min(width, height) / 2 - 2
        const x = width / 2, y = height / 2
        const k = illumination
        const right = waxing   // northern-hemisphere view: waxing Moon is lit on the right

        // earthshine-dark disc
        ctx.fillStyle = "#17171a"
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()

        const lit = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
        lit.addColorStop(0, "#f4f2ea")
        lit.addColorStop(0.7, "#cfccc2")
        lit.addColorStop(1, "#8d8a82")
        ctx.fillStyle = lit

        // lit half
        ctx.beginPath()
        if (right) ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false)
        else ctx.arc(x, y, r, Math.PI / 2, 3 * Math.PI / 2, false)
        ctx.closePath()
        ctx.fill()

        // terminator
        const rx = r * Math.abs(1 - 2 * k)
        ctx.fillStyle = k < 0.5 ? "#17171a" : lit
        ctx.beginPath()
        ctx.ellipse(x - rx, y - r, rx * 2, r * 2)
        ctx.fill()

        // a few maria, very roughly, so it reads as the Moon and not a ball
        ctx.save()
        ctx.globalAlpha = 0.18
        ctx.fillStyle = "#3a3a40"
        const blobs = [[-0.25, -0.3, 0.22], [0.15, -0.35, 0.16], [0.05, 0.05, 0.2],
                       [-0.35, 0.15, 0.14], [0.3, 0.2, 0.1]]
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.clip()
        for (const b of blobs) {
            ctx.beginPath(); ctx.arc(x + b[0] * r, y + b[1] * r, b[2] * r, 0, 2 * Math.PI); ctx.fill()
        }
        ctx.restore()

        // glass gloss + rim
        const g = ctx.createLinearGradient(x, y - r, x, y)
        g.addColorStop(0, Qt.rgba(1, 1, 1, 0.28))
        g.addColorStop(1, Qt.rgba(1, 1, 1, 0))
        ctx.fillStyle = g
        ctx.beginPath(); ctx.ellipse(x - r * 0.7, y - r * 0.95, r * 1.4, r * 1.0); ctx.fill()
        ctx.strokeStyle = Qt.rgba(1, 1, 1, 0.18)
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke()
    }
}
