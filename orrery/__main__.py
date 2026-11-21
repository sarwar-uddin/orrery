import os
import signal
import sys
from pathlib import Path

from PySide6.QtCore import QUrl
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtQml import QQmlApplicationEngine

from .sky import Sky

HERE = Path(__file__).resolve().parent


def main() -> int:
    # use the Plasma style/theme (Oxygen in this rice) rather than Qt's fallback
    os.environ.setdefault("QT_QUICK_CONTROLS_STYLE", "org.kde.desktop")
    app = QGuiApplication(sys.argv)
    app.setApplicationName("orrery")
    app.setApplicationDisplayName("Orrery")
    app.setOrganizationDomain("sarwaruddin.github.com")
    app.setDesktopFileName("com.github.sarwaruddin.orrery")
    app.setWindowIcon(QIcon.fromTheme("weather-clear-night"))
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    sky = Sky()
    engine = QQmlApplicationEngine()
    engine.setInitialProperties({"sky": sky})
    engine.load(QUrl.fromLocalFile(str(HERE / "qml" / "Main.qml")))
    if not engine.rootObjects():
        return 1
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
