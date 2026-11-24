import os
import signal
import sys
from pathlib import Path

from PySide6.QtCore import QUrl
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtQml import QQmlApplicationEngine

from .sky import Sky

HERE = Path(__file__).resolve().parent


def init_3d() -> bool:
    """Qt WebEngine has to be set up before the application object exists.
    Without it (or with ORRERY_NO_3D=1) the app runs with the 2D map only."""
    if os.environ.get("ORRERY_NO_3D"):
        return False
    try:
        from PySide6.QtWebEngineQuick import QtWebEngineQuick
    except ImportError:
        return False
    QtWebEngineQuick.initialize()
    return True


def main() -> int:
    # use the Plasma style/theme (Oxygen in this rice) rather than Qt's fallback
    os.environ.setdefault("QT_QUICK_CONTROLS_STYLE", "org.kde.desktop")
    has_3d = init_3d()
    app = QGuiApplication(sys.argv)
    app.setApplicationName("orrery")
    app.setOrganizationName("orrery")          # settings land in ~/.config/orrery/orrery.conf
    app.setApplicationDisplayName("Orrery")
    app.setOrganizationDomain("sarwaruddin.github.com")
    app.setDesktopFileName("com.github.sarwaruddin.orrery")
    app.setWindowIcon(QIcon.fromTheme("weather-clear-night"))
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    sky = Sky()
    engine = QQmlApplicationEngine()
    engine.setInitialProperties({"sky": sky, "has3d": has_3d})
    engine.load(QUrl.fromLocalFile(str(HERE / "qml" / "Main.qml")))
    if not engine.rootObjects():
        return 1
    code = app.exec()
    sky.shutdown()
    del engine  # tear QML down while `sky` still exists, so no bindings read a dead object
    return code


if __name__ == "__main__":
    sys.exit(main())
