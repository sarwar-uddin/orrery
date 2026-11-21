import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.ApplicationWindow {
    id: win
    required property var sky
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

        actions: [
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
                text: view.trueScale ? "Compressed scale" : "True scale"
                checkable: true
                checked: view.trueScale
                shortcut: "T"
                onTriggered: { view.trueScale = !view.trueScale; view.zoom = 1; view.panX = 0; view.panY = 0 }
            }
        ]

        RowLayout {
            anchors.fill: parent
            spacing: 0

            OrreryView {
                id: view
                sky: win.sky
                Layout.fillWidth: true
                Layout.fillHeight: true
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
