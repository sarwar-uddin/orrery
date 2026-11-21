import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

// A glassy card with a heading: the sidebar's building block.
Rectangle {
    id: card
    property string title
    property string subtitle
    property color accent: Kirigami.Theme.highlightColor
    default property alias content: body.data

    Layout.fillWidth: true
    implicitHeight: col.implicitHeight + Kirigami.Units.largeSpacing * 2
    radius: 6
    border.color: Qt.rgba(1, 1, 1, 0.09)
    gradient: Gradient {
        GradientStop { position: 0.0; color: Qt.lighter(Kirigami.Theme.backgroundColor, 1.35) }
        GradientStop { position: 0.12; color: Qt.lighter(Kirigami.Theme.backgroundColor, 1.12) }
        GradientStop { position: 1.0; color: Kirigami.Theme.backgroundColor }
    }

    ColumnLayout {
        id: col
        anchors { fill: parent; margins: Kirigami.Units.largeSpacing }
        spacing: Kirigami.Units.smallSpacing

        RowLayout {
            Layout.fillWidth: true
            Rectangle { width: 3; height: titleLabel.height; radius: 1; color: card.accent }
            QQC2.Label {
                id: titleLabel
                text: card.title
                font.bold: true
                font.capitalization: Font.AllUppercase
                font.letterSpacing: 1.2
                font.pointSize: Kirigami.Theme.smallFont.pointSize
                opacity: 0.85
            }
            Item { Layout.fillWidth: true }
            QQC2.Label {
                text: card.subtitle
                opacity: 0.6
                font.pointSize: Kirigami.Theme.smallFont.pointSize
            }
        }
        ColumnLayout {
            id: body
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing
        }
    }
}
