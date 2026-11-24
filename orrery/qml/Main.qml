import QtCore
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.ApplicationWindow {
    id: win
    required property var sky
    required property bool has3d          // Qt WebEngine present (see __main__.py)
    property bool show3d: true
    property bool trueScale: false
    readonly property bool in3d: has3d && show3d
    title: "Orrery"
    width: 1440
    height: 900
    minimumWidth: 960
    minimumHeight: 640

    pageStack.globalToolBar.style: Kirigami.ApplicationHeaderStyle.ToolBar
    pageStack.initialPage: Kirigami.Page {
        id: page
        padding: 0
        title: win.sky.live ? "Now" : win.sky.dateText

        // The 3D actions are left out entirely when there is no WebEngine:
        // Kirigami's toolbar warns about actions that are merely invisible.
        actions: {
            const out = []
            for (const a of clockActions) out.push(a)
            if (win.has3d) for (const a of viewActions) out.push(a)
            return out
        }

        property list<Kirigami.Action> clockActions: [
            Kirigami.Action {
                icon.name: "media-seek-backward"
                text: "Slower / reverse"
                displayHint: Kirigami.DisplayHint.IconOnly
                shortcut: "["
                onTriggered: win.sky.nudgeSpeed(-1)
            },
            Kirigami.Action {
                icon.name: win.sky.playing ? "media-playback-pause" : "media-playback-start"
                text: win.sky.playing ? "Pause" : "Play"
                displayHint: Kirigami.DisplayHint.IconOnly
                shortcut: "Space"
                onTriggered: win.sky.togglePlay()
            },
            Kirigami.Action {
                icon.name: "media-seek-forward"
                text: "Faster"
                displayHint: Kirigami.DisplayHint.IconOnly
                shortcut: "]"
                onTriggered: win.sky.nudgeSpeed(1)
            },
            Kirigami.Action { separator: true },
            Kirigami.Action {
                icon.name: "go-previous"
                text: "−1 day"
                shortcut: "Left"
                onTriggered: win.sky.step(-86400)
            },
            Kirigami.Action {
                icon.name: "go-next"
                text: "+1 day"
                shortcut: "Right"
                onTriggered: win.sky.step(86400)
            },
            Kirigami.Action {
                icon.name: "go-jump-today"
                text: "Now"
                enabled: !win.sky.live
                shortcut: "N"
                onTriggered: win.sky.goLive()
            },
            Kirigami.Action {
                icon.name: "view-calendar"
                text: "Go to date…"
                shortcut: "Ctrl+G"
                onTriggered: dateDialog.open()
            },
            Kirigami.Action {
                icon.name: "zoom-fit-best"
                text: win.trueScale ? "Compressed scale" : "True scale"
                checkable: true
                checked: win.trueScale
                shortcut: "T"
                onTriggered: { win.trueScale = !win.trueScale; view.zoom = 1; view.panX = 0; view.panY = 0 }
            },
        ]

        property list<Kirigami.Action> viewActions: [
            Kirigami.Action { separator: true },
            Kirigami.Action {
                icon.name: "globe"
                text: "3D"
                tooltip: "Switch between the 3D view and the flat map (V)"
                checkable: true
                checked: win.show3d
                shortcut: "V"
                onTriggered: win.show3d = !win.show3d
            },
            Kirigami.Action {
                icon.name: "camera-video"
                text: "Camera"
                enabled: win.in3d
                Kirigami.Action { text: "Overview"; shortcut: "1"; onTriggered: win.camera("overview") }
                Kirigami.Action { text: "Top down"; shortcut: "2"; onTriggered: win.camera("top") }
                Kirigami.Action { text: "Edge on"; shortcut: "3"; onTriggered: win.camera("edge") }
                Kirigami.Action { text: "From Earth"; shortcut: "4"; onTriggered: win.camera("earth") }
            }
        ]

        RowLayout {
            anchors.fill: parent
            spacing: 0

            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true

                OrreryView {
                    id: view
                    anchors.fill: parent
                    sky: win.sky
                    trueScale: win.trueScale
                    visible: !win.in3d
                }

                // Loaded by URL the first time it is shown, then kept (WebEngine is
                // slow to start). By URL so Main.qml never needs QtWebEngine itself.
                Loader {
                    id: view3d
                    anchors.fill: parent
                    visible: win.in3d
                    function ensure() {
                        if (visible && status === Loader.Null)
                            setSource("Orrery3D.qml", { sky: win.sky, trueScale: win.trueScale })
                    }
                    onVisibleChanged: ensure()
                    Component.onCompleted: ensure()
                }
                Binding {
                    target: view3d.item
                    property: "trueScale"
                    value: win.trueScale
                    when: view3d.item !== null
                }
            }

            Kirigami.Separator { Layout.fillHeight: true }

            QQC2.ScrollView {
                Layout.preferredWidth: Kirigami.Units.gridUnit * 21
                Layout.fillHeight: true
                contentWidth: availableWidth
                QQC2.ScrollBar.horizontal.policy: QQC2.ScrollBar.AlwaysOff

                Sidebar {
                    sky: win.sky
                    width: parent.width
                }
            }
        }
    }

    function camera(preset) {
        if (win.in3d && view3d.item) view3d.item.camera(preset)
    }

    Settings {
        property alias show3d: win.show3d
        property alias trueScale: win.trueScale
    }

    Kirigami.PromptDialog {
        id: dateDialog
        title: "Go to date"
        subtitle: "Anything from 1800 to 2050 (the range the orbital elements are good for)."
        standardButtons: Kirigami.Dialog.Ok | Kirigami.Dialog.Cancel
        onAccepted: {
            const m = dateField.text.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/)
            if (m) win.sky.jumpToDate(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]))
        }
        onOpened: { dateField.forceActiveFocus(); dateField.selectAll() }
        QQC2.TextField {
            id: dateField
            placeholderText: "YYYY-MM-DD"
            text: Qt.formatDate(new Date(), "yyyy-MM-dd")
            onAccepted: dateDialog.accept()
        }
    }
}
