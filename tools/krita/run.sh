#!/usr/bin/env bash
# Run a Krita Python script headless (the krita-brushwork skill): Krita under Xvfb, the fc_runner plugin runs the
# script once the first window exists, and Krita quits with the script's exit code. Install with
# scripts/install-krita.sh first.
#
# Usage: tools/krita/run.sh script.py [args...]   (args reach the script as sys.argv[1:] via FC_KRITA_ARGS)
set -euo pipefail
script="$(realpath "$1")"; shift
export LD_LIBRARY_PATH=/opt/krita/usr/lib
export PYTHONHOME=/opt/krita/usr
export PYTHONPATH="/opt/krita/usr/lib/python3.13/site-packages:/opt/krita/usr/lib/krita-python-libs:$(dirname "$script")"
export FC_KRITA_SCRIPT="$script"
FC_KRITA_ARGS="$(printf '%s\n' "$@")"
export FC_KRITA_ARGS
log="$(mktemp)"
set +e
timeout "${KRITA_TIMEOUT:-600}" xvfb-run -a -s "-screen 0 1600x1000x24" /opt/krita/usr/bin/krita --nosplash >"$log" 2>&1
set -e
grep -v -e '^Fontconfig' -e 'XDG_RUNTIME_DIR' -e 'db.migration' -e 'QML ToolTip' -e 'imageRectInWidgetPixels' -e 'documentOffsetF' -e 'startTimer' -e 'added to PYTHONPATH' "$log" >&2 || true
code="$(sed -n 's/^FC_KRITA_EXIT \([0-9]*\)$/\1/p' "$log" | tail -1)"
rm -f "$log"
if [[ -z "$code" ]]; then echo "krita: the script never finished (timeout or crash)" >&2; exit 1; fi
exit "$code"
