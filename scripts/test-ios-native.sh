#!/usr/bin/env bash
# The iOS durable store on this Mac: real files and a real WKWebView, no Xcode.
# DurableStore.swift uses only Foundation, WebKit and CryptoKit, which macOS has.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v swiftc >/dev/null || { echo "[test-ios-native] swiftc missing — xcode-select --install" >&2; exit 1; }

# Command Line Tools may ship SDKs newer than their compiler; take the newest one it can build with.
echo 'import Foundation' >"$WORK/probe.swift"
SDK_ARGS=()
if ! swiftc -typecheck "$WORK/probe.swift" 2>/dev/null; then
  found=""
  for sdk in $(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX[0-9]*.sdk 2>/dev/null | sort -rV); do
    if swiftc -sdk "$sdk" -typecheck "$WORK/probe.swift" 2>/dev/null; then found="$sdk"; break; fi
  done
  [[ -n "$found" ]] || { echo "[test-ios-native] no macOS SDK matches $(swiftc --version 2>&1 | head -1)" >&2; exit 1; }
  SDK_ARGS=(-sdk "$found")
fi

for test in "$ROOT"/native-ios/tests/*.swift; do
  name="$(basename "$test" .swift)"
  mkdir -p "$WORK/$name"
  cp "$test" "$WORK/$name/main.swift"
  swiftc -O ${SDK_ARGS[@]+"${SDK_ARGS[@]}"} -o "$WORK/$name/run" "$ROOT/native-ios/DurableStore.swift" "$WORK/$name/main.swift"
  echo "[test-ios-native] $name"
  "$WORK/$name/run" 2>&1 | grep -Ev '^[0-9]{4}-[0-9]{2}-[0-9]{2} ' || exit 1
done
