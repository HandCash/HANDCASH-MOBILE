#!/usr/bin/env bash
# One-time on the Mac that already installs on your phone: export the debug key
# every build host must share. Copy native-android/handcash-lab.keystore to Linux.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${HANDCASH_ANDROID_KEYSTORE:-$HOME/.android/debug.keystore}"
DST="$ROOT/native-android/handcash-lab.keystore"
if [[ ! -f "$SRC" ]]; then
  echo "No keystore at $SRC — build an APK on this machine once so Android creates ~/.android/debug.keystore" >&2
  exit 1
fi
cp "$SRC" "$DST"
echo "Wrote $DST"
echo "Commit or scp this file to your Linux build host, then rebuild the APK."
