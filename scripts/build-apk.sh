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

yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" \
  "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/tmp/sdkmanager.log || true

npm install

# Fail closed unless sibling Desktop UI core is pinned (version + git SHA).
node "$ROOT/scripts/assert-ui-core.mjs"

npm run build
node node_modules/@capacitor/cli/bin/capacitor add android 2>/dev/null || true
node node_modules/@capacitor/cli/bin/capacitor sync android

node "$ROOT/scripts/patch-android.mjs"

(
  cd android
  ./gradlew assembleDebug
)

MOBILE_VERSION="$(node -p "require('./package.json').version")"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
mkdir -p "$ROOT/artifacts"
OUT="$ROOT/artifacts/handcash-mobile-${MOBILE_VERSION}.apk"
cp "$APK" "$OUT"
cp "$APK" "$ROOT/artifacts/handcash-mobile-debug.apk"
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
ls -la "$OUT" "$ROOT/artifacts/handcash-mobile-debug.apk" "$ROOT/artifacts/ui-core-pin.json"
