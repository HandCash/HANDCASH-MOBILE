#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Reject an unpinned or dirty shared core before downloading tools or replacing
# dependencies. A refused release must leave the existing build setup alone.
node "$ROOT/scripts/assert-ui-core.mjs"

# Refuse an unsigned release before downloading tools or replacing dependencies.
if [[ "${HANDCASH_BUILD_TYPE:-release}" != "debug" ]]; then
  : "${HANDCASH_ANDROID_KEYSTORE:?Release requires the stable private signing keystore}"
  : "${HANDCASH_ANDROID_STORE_PASSWORD:?Release requires store password}"
  : "${HANDCASH_ANDROID_KEY_ALIAS:?Release requires key alias}"
  : "${HANDCASH_ANDROID_KEY_PASSWORD:?Release requires key password}"
  : "${HANDCASH_ANDROID_CERT_SHA256:?Release requires the expected signer certificate fingerprint}"
fi

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
    ./gradlew assembleRelease
  fi
)

MOBILE_VERSION="$(node -p "require('./package.json').version")"
APKSIGNER="$ANDROID_HOME/build-tools/35.0.0/apksigner"
signerFor() {
  "$APKSIGNER" verify --print-certs --min-sdk-version "$1" --max-sdk-version "$2" "$3" 2>/dev/null \
    | awk '/Signer #1 certificate SHA-256 digest:/ {print $NF}'
}
rotateApk() {
  # APK Signature Scheme v3 lineage: in-place upgrade across key change.
  # Android 6–8 keep the previous signer; Android 9+ trusts the next key via lineage.
  local apk="$1" lineage="$2"
  local old_ks="$3" old_alias="$4" old_store_env="$5" old_key_env="$6"
  local next_ks="$7" next_alias="$8" next_pass="$9" old_sha="${10}" next_sha="${11}"
  local rotated="${apk}.rotated"
  [[ -f "$lineage" ]] || { echo "Missing signing lineage $lineage" >&2; exit 1; }
  [[ -f "$old_ks" ]] || { echo "Previous keystore $old_ks not found — rotation needs the key phones already trust" >&2; exit 1; }
  [[ -f "$next_ks" ]] || { echo "Next keystore $next_ks not found" >&2; exit 1; }
  "$APKSIGNER" sign \
    --ks "$old_ks" --ks-key-alias "$old_alias" \
    --ks-pass "env:${old_store_env}" --key-pass "env:${old_key_env}" \
    --next-signer --ks "$next_ks" --ks-key-alias "$next_alias" --ks-pass "pass:${next_pass}" \
    --lineage "$lineage" --rotation-min-sdk-version 28 \
    --out "$rotated" "$apk"
  mv -f "$rotated" "$apk"
  rm -f "${rotated}.idsig" "${apk}.idsig"
  local got_old got_next
  got_old="$(signerFor 23 27 "$apk")"
  got_next="$(signerFor 28 35 "$apk")"
  [[ "$got_old" == "$old_sha" ]] || { echo "Android 6-8 signer is ${got_old:-missing}, expected $old_sha" >&2; exit 1; }
  [[ "$got_next" == "$next_sha" ]] || { echo "Android 9+ signer is ${got_next:-missing}, expected $next_sha" >&2; exit 1; }
  echo "Rotated APK in place (lineage): Android 6-8=$got_old  Android 9+=$got_next"
}

if [[ "${HANDCASH_BUILD_TYPE:-release}" == "debug" ]]; then
  APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
  # Lab rotate: previous Mac/debug cert → current lab cert. Lineage is committed;
  # private keystores stay out of the public repo (CI secrets / ~/.handcash).
  LAB_LINEAGE="$ROOT/native-android/lab-signing-lineage.bin"
  LAB_OLD_KS="${HANDCASH_ANDROID_LAB_OLD_KEYSTORE:-$HOME/.handcash/android-signing/handcash-lab-old.keystore}"
  LAB_NEW_KS="$ROOT/native-android/handcash-lab.keystore"
  LAB_OLD_SHA="${HANDCASH_ANDROID_LAB_OLD_CERT_SHA256:-b6de8e22d0cf9bf4a01c0f60e004a98de8d1e9a1f611adaf9945b38498f64ec4}"
  LAB_NEW_SHA="${HANDCASH_ANDROID_LAB_CERT_SHA256:-600442ea52cebd1b3d00037d19acb79d4e1ae0cf292e4cc2d21377ba38e847b8}"
  if [[ -f "$LAB_LINEAGE" && -f "$LAB_OLD_KS" && -f "$LAB_NEW_KS" ]]; then
    export HANDCASH_ANDROID_LAB_OLD_STORE_PASSWORD="${HANDCASH_ANDROID_LAB_OLD_STORE_PASSWORD:-android}"
    export HANDCASH_ANDROID_LAB_OLD_KEY_PASSWORD="${HANDCASH_ANDROID_LAB_OLD_KEY_PASSWORD:-android}"
    rotateApk "$APK" "$LAB_LINEAGE" \
      "$LAB_OLD_KS" androiddebugkey HANDCASH_ANDROID_LAB_OLD_STORE_PASSWORD HANDCASH_ANDROID_LAB_OLD_KEY_PASSWORD \
      "$LAB_NEW_KS" androiddebugkey android \
      "$LAB_OLD_SHA" "$LAB_NEW_SHA"
  elif [[ -f "$LAB_LINEAGE" ]]; then
    echo "Lab lineage present but old keystore missing at $LAB_OLD_KS — APK will NOT upgrade installs signed with the previous key." >&2
    echo "Restore handcash-lab-old.keystore (CI secret HANDCASH_ANDROID_LAB_OLD_KEYSTORE_BASE64) for real rotation." >&2
  fi
else
  APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
  # Production rotate: original release key → HandCash release key. Release key never enters the repo.
  LINEAGE="$ROOT/native-android/signing-lineage.bin"
  NEXT_KS="${HANDCASH_ANDROID_NEXT_KEYSTORE:-$HOME/.handcash/android-signing/handcash-release.p12}"
  NEXT_ALIAS="${HANDCASH_ANDROID_NEXT_KEY_ALIAS:-handcash-release}"
  NEXT_SHA="${HANDCASH_ANDROID_NEXT_CERT_SHA256:-4a0dae371b99461cc6db57c63d7105cb9ffde34d3bb6b3f4dbfaa148442d8c4e}"
  NEXT_PASS="${HANDCASH_ANDROID_NEXT_STORE_PASSWORD:-$(security find-generic-password -s handcash-android-release -a "$NEXT_ALIAS" -w 2>/dev/null || true)}"
  [[ -n "$NEXT_PASS" ]] || { echo "Release key password not in env or Keychain (handcash-android-release)" >&2; exit 1; }
  : "${HANDCASH_ANDROID_KEY_PASSWORD:?Release requires key password}"
  expected=$(printf '%s' "$HANDCASH_ANDROID_CERT_SHA256" | tr -d ':' | tr '[:upper:]' '[:lower:]')
  rotateApk "$APK" "$LINEAGE" \
    "$HANDCASH_ANDROID_KEYSTORE" "$HANDCASH_ANDROID_KEY_ALIAS" HANDCASH_ANDROID_STORE_PASSWORD HANDCASH_ANDROID_KEY_PASSWORD \
    "$NEXT_KS" "$NEXT_ALIAS" "$NEXT_PASS" \
    "$expected" "$NEXT_SHA"
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
