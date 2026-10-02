#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JDK_ROOT="${JDK_ROOT:-$HOME/.local/jdk}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android-sdk}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin)
    sdk_zip="commandlinetools-mac-11076708_latest.zip"
    if [[ "$arch" == "arm64" ]]; then
      jdk_arch="aarch64"
      adoptium_os="mac"
    else
      jdk_arch="x64"
      adoptium_os="mac"
    fi
  ;;
  Linux)
    sdk_zip="commandlinetools-linux-11076708_latest.zip"
    jdk_arch="x64"
    adoptium_os="linux"
  ;;
  *)
    echo "Unsupported OS: $os" >&2
    exit 1
  ;;
esac

# Capacitor 7 / AGP need JDK 21+
if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" ]]; then
  if [[ "$os" == "Darwin" ]] && compgen -G "$JDK_ROOT/jdk-21*/Contents/Home/bin/java" > /dev/null; then
    JAVA_HOME="$(echo "$JDK_ROOT"/jdk-21*/Contents/Home)"
  elif compgen -G "$JDK_ROOT/jdk-21*/bin/java" > /dev/null; then
    JAVA_HOME="$(echo "$JDK_ROOT"/jdk-21*)"
  else
    echo "Downloading portable Temurin JDK 21…"
    mkdir -p "$JDK_ROOT"
    curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/${adoptium_os}/${jdk_arch}/jdk/hotspot/normal/eclipse?project=jdk" \
      -o /tmp/handcash-jdk21.tar.gz
    tar -xzf /tmp/handcash-jdk21.tar.gz -C "$JDK_ROOT"
    if [[ "$os" == "Darwin" ]] && compgen -G "$JDK_ROOT/jdk-21*/Contents/Home/bin/java" > /dev/null; then
      JAVA_HOME="$(echo "$JDK_ROOT"/jdk-21*/Contents/Home)"
    else
      JAVA_HOME="$(echo "$JDK_ROOT"/jdk-21*)"
    fi
  fi
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
echo "Using JAVA_HOME=$JAVA_HOME"
java -version

if [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
  echo "Downloading Android cmdline-tools ($os)…"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  curl -fsSL "https://dl.google.com/android/repository/${sdk_zip}" \
    -o /tmp/android-cmdline-tools.zip
  rm -rf /tmp/android-cmdline-tools
  unzip -q /tmp/android-cmdline-tools.zip -d /tmp/android-cmdline-tools
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mkdir -p "$ANDROID_HOME/cmdline-tools/latest"
  mv /tmp/android-cmdline-tools/cmdline-tools/* "$ANDROID_HOME/cmdline-tools/latest/"
fi

# Licence answers come from process substitution: under pipefail, `yes |`
# fails the build with SIGPIPE whenever sdkmanager exits without reading.
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" \
  "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/tmp/sdkmanager.log < <(yes)

npm ci

# Fail closed unless sibling Desktop UI core is pinned (version + git SHA).
node "$ROOT/scripts/assert-ui-core.mjs"

npm run build
if [[ ! -d android ]]; then
  node node_modules/@capacitor/cli/bin/capacitor add android
fi
node node_modules/@capacitor/cli/bin/capacitor sync android

node "$ROOT/scripts/patch-android.mjs"

(
  cd android
  if [[ "${HANDCASH_BUILD_TYPE:-release}" == "debug" ]]; then
    ./gradlew assembleDebug
  else
    : "${HANDCASH_ANDROID_KEYSTORE:?Release requires the stable private signing keystore}"
    : "${HANDCASH_ANDROID_STORE_PASSWORD:?Release requires store password}"
    : "${HANDCASH_ANDROID_KEY_ALIAS:?Release requires key alias}"
    : "${HANDCASH_ANDROID_KEY_PASSWORD:?Release requires key password}"
    : "${HANDCASH_ANDROID_CERT_SHA256:?Release requires the expected signer certificate fingerprint}"
    ./gradlew assembleRelease
  fi
)

MOBILE_VERSION="$(node -p "require('./package.json').version")"
if [[ "${HANDCASH_BUILD_TYPE:-release}" == "debug" ]]; then
  APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
else
  APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
  APKSIGNER="$ANDROID_HOME/build-tools/35.0.0/apksigner"
  # Key rotation (APK Signature Scheme v3): Android 9+ trusts the release key
  # through the lineage; older Android and v1/v2 keep the original signer, so
  # every install updates in place. The release key never enters the repo.
  LINEAGE="$ROOT/native-android/signing-lineage.bin"
  NEXT_KS="${HANDCASH_ANDROID_NEXT_KEYSTORE:-$HOME/.handcash/android-signing/handcash-release.p12}"
  NEXT_ALIAS="${HANDCASH_ANDROID_NEXT_KEY_ALIAS:-handcash-release}"
  NEXT_SHA="${HANDCASH_ANDROID_NEXT_CERT_SHA256:-4a0dae371b99461cc6db57c63d7105cb9ffde34d3bb6b3f4dbfaa148442d8c4e}"
  [[ -f "$LINEAGE" ]] || { echo "Missing signing lineage $LINEAGE" >&2; exit 1; }
  [[ -f "$NEXT_KS" ]] || { echo "Release key $NEXT_KS not found — restore it from backup" >&2; exit 1; }
  NEXT_PASS="${HANDCASH_ANDROID_NEXT_STORE_PASSWORD:-$(security find-generic-password -s handcash-android-release -a "$NEXT_ALIAS" -w 2>/dev/null || true)}"
  [[ -n "$NEXT_PASS" ]] || { echo "Release key password not in env or Keychain (handcash-android-release)" >&2; exit 1; }
  ROTATED="$APK.rotated"
  "$APKSIGNER" sign \
    --ks "$HANDCASH_ANDROID_KEYSTORE" --ks-key-alias "$HANDCASH_ANDROID_KEY_ALIAS" \
    --ks-pass "env:HANDCASH_ANDROID_STORE_PASSWORD" --key-pass "env:HANDCASH_ANDROID_KEY_PASSWORD" \
    --next-signer --ks "$NEXT_KS" --ks-key-alias "$NEXT_ALIAS" --ks-pass "pass:$NEXT_PASS" \
    --lineage "$LINEAGE" --rotation-min-sdk-version 28 \
    --out "$ROTATED" "$APK"
  mv -f "$ROTATED" "$APK"
  rm -f "$ROTATED.idsig" "$APK.idsig"
  signerFor() {
    "$APKSIGNER" verify --print-certs --min-sdk-version "$1" --max-sdk-version "$2" "$APK" 2>/dev/null \
      | awk '/Signer #1 certificate SHA-256 digest:/ {print $NF}'
  }
  expected=$(printf '%s' "$HANDCASH_ANDROID_CERT_SHA256" | tr -d ':' | tr '[:upper:]' '[:lower:]')
  [[ "$(signerFor 23 27)" == "$expected" ]] || { echo "Android 6-8 signer is not the original certificate" >&2; exit 1; }
  [[ "$(signerFor 28 35)" == "$NEXT_SHA" ]] || { echo "Android 9+ signer is not the rotated release certificate" >&2; exit 1; }
fi
mkdir -p "$ROOT/artifacts"
OUT="$ROOT/artifacts/handcash-mobile-${MOBILE_VERSION}.apk"
cp "$APK" "$OUT"
if [[ "${HANDCASH_BUILD_TYPE:-release}" == "debug" ]]; then cp "$APK" "$ROOT/artifacts/handcash-mobile-debug.apk"; fi
if command -v sha256sum >/dev/null 2>&1; then
  SHA="$(sha256sum "$OUT" | awk '{print $1}')"
else
  SHA="$(shasum -a 256 "$OUT" | awk '{print $1}')"
fi
echo "$SHA  $(basename "$OUT")" | tee "$OUT.sha256"
node "$ROOT/scripts/assert-ui-core.mjs" --out "artifacts/ui-core-pin.json"
cp -f "$ROOT/artifacts/ui-core-pin.json" "$ROOT/artifacts/handcash-mobile-${MOBILE_VERSION}.ui-core-pin.json"
echo "APK ready: $OUT"
echo "SHA-256: $SHA"
ls -la "$OUT" "$ROOT/artifacts/ui-core-pin.json"
