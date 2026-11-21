import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2

// key  ........  value
RowLayout {
    property alias key: k.text
    property alias value: v.text
    Layout.fillWidth: true
    QQC2.Label { id: k; opacity: 0.6; Layout.minimumWidth: 96 }
    QQC2.Label {
        id: v
        Layout.fillWidth: true
        horizontalAlignment: Text.AlignRight
        elide: Text.ElideLeft
        font.family: "JetBrains Mono"
    }
}
