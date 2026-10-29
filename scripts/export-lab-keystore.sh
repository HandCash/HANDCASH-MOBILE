#!/usr/bin/env bash
# One-time on the Mac that already installs on your phone: export the debug key
# every build host must share. File is gitignored — never commit (repo is public).
# For CI:  base64 -w0 native-android/handcash-lab.keystore | gh secret set HANDCASH_ANDROID_LAB_KEYSTORE_BASE64
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${HANDCASH_ANDROID_KEYSTORE:-$HOME/.android/debug.keystore}"
DST="$ROOT/native-android/handcash-lab.keystore"
if [[ ! -f "$SRC" ]]; then
  echo "No keystore at $SRC — build an APK on this machine once so Android creates ~/.android/debug.keystore" >&2
  exit 1
fi
cp "$SRC" "$DST"
chmod 600 "$DST"
echo "Wrote $DST (gitignored — do not commit)"
echo "scp to your Linux build host, or: base64 -w0 \"$DST\" | gh secret set HANDCASH_ANDROID_LAB_KEYSTORE_BASE64 --repo HandCash/HANDCASH-MOBILE"
