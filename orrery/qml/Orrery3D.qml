import QtQuick
import QtWebEngine
import QtWebChannel
import org.kde.kirigami as Kirigami

// The three.js view (orrery/web/). Python stays the source of truth: every
// snapshot is pushed into the page as JSON; clicks come back over the
// WebChannel "bridge".
Item {
    id: root
    objectName: "orrery3d"
    required property var sky
    property bool trueScale: false
    readonly property color accent: Kirigami.Theme.highlightColor
    property bool ready: false

    function js(code) { if (ready) web.runJavaScript(code) }
    function pushScene() { js("orrery.update(" + sky.scene3d + ")") }
    function pushOrbits() { js("orrery.setOrbits(" + sky.orbits3d + ")") }
    function pushOptions() {
        js("orrery.setOptions(" + JSON.stringify({ trueScale: trueScale, accent: accent.toString() }) + ")")
    }
    function pushAll() {
        js("orrery.setStatic(" + sky.static3d + ")")
        pushOptions()
        pushOrbits()
        pushScene()
    }
    function camera(preset) { js("orrery.camera(" + JSON.stringify(preset) + ")") }

    onTrueScaleChanged: pushOptions()
    onAccentChanged: pushOptions()
    onVisibleChanged: if (visible) pushAll()

    QtObject {
        id: bridge
        WebChannel.id: "bridge"
        // "" means "clicked empty space": clear the selection, as the 2D map does
        function pick(name) {
            if (name) root.sky.select(name)
            else if (root.sky.selected) root.sky.select(root.sky.selected)
        }
    }

    WebChannel {
        id: channel
        registeredObjects: [bridge]
    }

    Connections {
        target: root.sky
        enabled: root.ready && root.visible
        function onSceneChanged() { root.pushScene() }
        function onOrbitsChanged() { root.pushOrbits() }
    }

    WebEngineView {
        id: web
        objectName: "web3d"
        anchors.fill: parent
        backgroundColor: "#040405"
        // never take keyboard focus, so Space, [ ] and the arrows stay the app's
        activeFocusOnPress: false
        webChannel: channel
        url: Qt.resolvedUrl("../web/index.html")
        settings.showScrollBars: false
        settings.localContentCanAccessFileUrls: true
        settings.localContentCanAccessRemoteUrls: false
        settings.javascriptCanOpenWindows: false

        onLoadingChanged: (info) => {
            if (info.status === WebEngineView.LoadSucceededStatus) {
                root.ready = true
                root.pushAll()
            } else if (info.status === WebEngineView.LoadFailedStatus) {
                console.warn("orrery 3d: page failed to load:", info.errorString)
            }
        }
        onJavaScriptConsoleMessage: (level, message, line, source) => {
            if (level !== WebEngineView.InfoMessageLevel)
                console.warn(`orrery 3d: ${message} (${source}:${line})`)
        }
        // a crashed GPU process shouldn't leave a black hole in the window
        onRenderProcessTerminated: (status, code) => {
            root.ready = false
            reloadTimer.start()
        }
        onContextMenuRequested: (request) => request.accepted = true
        // the page is local; never wander off to anything else
        onNavigationRequested: (request) => {
            if (request.url.toString().indexOf("file:") !== 0) request.reject()
        }
    }

    Timer { id: reloadTimer; interval: 1000; onTriggered: web.reload() }
}
