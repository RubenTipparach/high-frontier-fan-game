# Fleet Command's Krita script runner: a Python plugin that, when FC_KRITA_SCRIPT names a script, waits for Krita's
# first window, runs the script and quits with its exit code. It exists because Krita's brush engines paint only through
# a view (kritarunner has no window, and Node.paintLine segfaults there), so a scripted stroke needs the full
# application under Xvfb. Installed by scripts/install-krita.sh; driven by tools/krita/run.sh.
import os
import runpy
import traceback

from krita import Extension, Krita
from PyQt5.QtCore import QTimer


def _run() -> None:
    """Runs the script named by FC_KRITA_SCRIPT as __main__, prints FC_KRITA_EXIT <code> and exits Krita."""
    code = 0
    try:
        runpy.run_path(os.environ["FC_KRITA_SCRIPT"], run_name="__main__")
    except SystemExit as e:
        code = int(e.code or 0)
    except Exception:
        traceback.print_exc()
        code = 1
    print("FC_KRITA_EXIT", code, flush=True)
    os._exit(code)


class FcRunner(Extension):
    """Polls for the first window (windowCreated fires before an extension can connect) and then runs the script."""

    def setup(self) -> None:
        if not os.environ.get("FC_KRITA_SCRIPT"):
            return
        self._timer = QTimer()
        self._timer.timeout.connect(self._poll)
        self._timer.start(500)

    def _poll(self) -> None:
        if Krita.instance().activeWindow() is not None:
            self._timer.stop()
            QTimer.singleShot(1000, _run)

    def createActions(self, window) -> None:
        pass


Krita.instance().addExtension(FcRunner(Krita.instance()))
