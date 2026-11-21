import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

ColumnLayout {
    id: side
    required property var sky
    spacing: Kirigami.Units.largeSpacing

    Item { implicitHeight: 1 }

    // --- clock
    InfoCard {
        Layout.leftMargin: Kirigami.Units.largeSpacing
        Layout.rightMargin: Kirigami.Units.largeSpacing
        title: side.sky.placeName
        subtitle: side.sky.speedText

        RowLayout {
            QQC2.Label {
                text: side.sky.timeText
                font.family: "JetBrains Mono"
                font.pointSize: 26
                font.weight: Font.Light
            }
            Item { Layout.fillWidth: true }
            Rectangle {
                visible: side.sky.live
                radius: height / 2
                implicitWidth: liveLabel.implicitWidth + 14
                implicitHeight: liveLabel.implicitHeight + 4
                color: Qt.rgba(Kirigami.Theme.highlightColor.r, Kirigami.Theme.highlightColor.g,
                               Kirigami.Theme.highlightColor.b, 0.25)
                border.color: Kirigami.Theme.highlightColor
                QQC2.Label {
                    id: liveLabel
                    anchors.centerIn: parent
                    text: "● LIVE"
                    font.pointSize: Kirigami.Theme.smallFont.pointSize
                    font.bold: true
                }
            }
        }
        QQC2.Label { text: side.sky.dateText }
        QQC2.Label { text: side.sky.utcText; opacity: 0.5; font.pointSize: Kirigami.Theme.smallFont.pointSize }
    }

    // --- selected planet
    InfoCard {
        Layout.leftMargin: Kirigami.Units.largeSpacing
        Layout.rightMargin: Kirigami.Units.largeSpacing
        visible: !!side.sky.selectedInfo.name
        title: side.sky.selectedInfo.name ?? ""
        subtitle: side.sky.selectedInfo.subtitle ?? ""
        accent: side.sky.selectedInfo.color ?? Kirigami.Theme.highlightColor
        Repeater {
            model: side.sky.selectedInfo.rows ?? []
            KV { required property var modelData; key: modelData[0]; value: modelData[1] }
        }
    }

    // --- moon
    InfoCard {
        Layout.leftMargin: Kirigami.Units.largeSpacing
        Layout.rightMargin: Kirigami.Units.largeSpacing
        title: "Moon"
        subtitle: side.sky.moon.constellation ? "in " + side.sky.moon.constellation : ""

        RowLayout {
            spacing: Kirigami.Units.largeSpacing
            MoonDisc {
                illumination: side.sky.moon.illumination ?? 0.5
                waxing: side.sky.moon.waxing ?? true
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 0
                QQC2.Label { text: side.sky.moon.name ?? ""; font.pointSize: 13 }
                QQC2.Label {
                    text: `${Math.round((side.sky.moon.illumination ?? 0) * 100)}% lit · ${side.sky.moon.age ?? ""} old`
                    opacity: 0.7
                }
                QQC2.Label { text: side.sky.moon.distance ?? ""; opacity: 0.5; font.family: "JetBrains Mono" }
            }
        }
        KV { key: "Rise / set"; value: `${side.sky.moon.rise ?? "—"}  /  ${side.sky.moon.set ?? "—"}` }
        KV { key: "Now"; value: side.sky.moon.now ?? "" }
        Repeater {
            model: side.sky.moon.upcoming ?? []
            KV { required property var modelData; key: "Next " + modelData[0].toLowerCase(); value: modelData[1] }
        }
    }

    // --- tonight
    InfoCard {
        Layout.leftMargin: Kirigami.Units.largeSpacing
        Layout.rightMargin: Kirigami.Units.largeSpacing
        title: "Tonight's sky"
        subtitle: "after dusk, 8°+ up"

        Repeater {
            model: side.sky.tonight
            delegate: QQC2.ItemDelegate {
                id: row
                required property var modelData
                Layout.fillWidth: true
                leftPadding: Kirigami.Units.smallSpacing
                rightPadding: Kirigami.Units.smallSpacing
                highlighted: side.sky.selected === modelData.name
                onClicked: if (modelData.name !== "Moon") side.sky.select(modelData.name)
                contentItem: RowLayout {
                    spacing: Kirigami.Units.smallSpacing
                    Rectangle {
                        Layout.alignment: Qt.AlignTop
                        Layout.topMargin: 4
                        width: 10; height: 10; radius: 5
                        color: row.modelData.color
                        opacity: row.modelData.visible ? 1 : 0.35
                        border.color: Qt.rgba(1, 1, 1, 0.3)
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 0
                        RowLayout {
                            QQC2.Label {
                                text: row.modelData.name + (row.modelData.up ? "  ▴ up now" : "")
                                font.bold: row.modelData.visible
                                opacity: row.modelData.visible ? 1 : 0.55
                            }
                            Item { Layout.fillWidth: true }
                            QQC2.Label {
                                text: row.modelData.mag ? "mag " + row.modelData.mag : ""
                                opacity: 0.5
                                font.family: "JetBrains Mono"
                                font.pointSize: Kirigami.Theme.smallFont.pointSize
                            }
                        }
                        QQC2.Label {
                            Layout.fillWidth: true
                            text: row.modelData.text
                            wrapMode: Text.Wrap
                            opacity: row.modelData.visible ? 0.75 : 0.4
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                        }
                    }
                }
            }
        }
    }

    // --- sun
    InfoCard {
        Layout.leftMargin: Kirigami.Units.largeSpacing
        Layout.rightMargin: Kirigami.Units.largeSpacing
        title: "Sun"
        subtitle: side.sky.sun.constellation ? "in " + side.sky.sun.constellation : ""
        KV { key: "Sunrise"; value: side.sky.sun.rise ?? "" }
        KV { key: "Solar noon"; value: side.sky.sun.noon ?? "" }
        KV { key: "Sunset"; value: side.sky.sun.set ?? "" }
        KV { key: "Daylight"; value: side.sky.sun.length ?? "" }
        KV { key: "Now"; value: side.sky.sun.now ?? "" }
    }

    Item { implicitHeight: Kirigami.Units.largeSpacing }
}
