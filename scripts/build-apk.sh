#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JDK_ROOT="${JDK_ROOT:-$HOME/.local/jdk}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/android-sdk}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

arch="$(uname -m)"
if [[ "$arch" == "arm64" ]]; then
  jarch="aarch64"
else
  jarch="x64"
fi

# Capacitor 7 / AGP need JDK 21+
if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" ]]; then
  if compgen -G "$JDK_ROOT/jdk-21*/Contents/Home/bin/java" > /dev/null; then
    JAVA_HOME="$(echo "$JDK_ROOT"/jdk-21*/Contents/Home)"
  elif compgen -G "$JDK_ROOT/jdk-21*/bin/java" > /dev/null; then
    JAVA_HOME="$(echo "$JDK_ROOT"/jdk-21*)"
  else
    echo "Downloading portable Temurin JDK 21…"
    mkdir -p "$JDK_ROOT"
    curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/mac/${jarch}/jdk/hotspot/normal/eclipse?project=jdk" \
      -o /tmp/handcash-jdk21.tar.gz
    tar -xzf /tmp/handcash-jdk21.tar.gz -C "$JDK_ROOT"
    if compgen -G "$JDK_ROOT/jdk-21*/Contents/Home/bin/java" > /dev/null; then
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
  echo "Downloading Android cmdline-tools…"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  curl -fsSL https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip \
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
npm run build
npx cap add android 2>/dev/null || true
npx cap sync android

# Restore tracked native plugins (android/ is gitignored).
NATIVE_SRC="$ROOT/native-android"
NATIVE_DST="$ROOT/android/app/src/main/java/io/handcash/mobile"
if [[ -d "$NATIVE_SRC" && -d "$NATIVE_DST" ]]; then
  mkdir -p "$NATIVE_DST"
  cp -f "$NATIVE_SRC"/*.java "$NATIVE_DST/" 2>/dev/null || true
fi

# Cleartext LAN pairing + camera + biometrics
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
if [[ -f "$MANIFEST" ]]; then
  if ! grep -q 'android.permission.CAMERA' "$MANIFEST"; then
    perl -i -0pe 's|<manifest([^>]*)>|<manifest$1>\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />|' "$MANIFEST"
  fi
  if ! grep -q 'USE_BIOMETRIC' "$MANIFEST"; then
    perl -i -0pe 's|(<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />)|$1\n    <uses-permission android:name="android.permission.USE_BIOMETRIC" />\n    <uses-permission android:name="android.permission.USE_FINGERPRINT" />|' "$MANIFEST"
  fi
  if ! grep -q 'usesCleartextTraffic' "$MANIFEST"; then
    perl -i -pe 's|<application|<application android:usesCleartextTraffic="true"|' "$MANIFEST"
  fi
  if grep -q 'android:allowBackup="true"' "$MANIFEST"; then
    perl -i -pe 's|android:allowBackup="true"|android:allowBackup="false"|' "$MANIFEST"
  fi
  if ! grep -q 'fullBackupContent' "$MANIFEST"; then
    perl -i -pe 's|android:allowBackup="false"|android:allowBackup="false"\n        android:fullBackupContent="false"\n        android:dataExtractionRules="@xml/data_extraction_rules"|' "$MANIFEST"
  fi
fi

RULES="$ROOT/android/app/src/main/res/xml/data_extraction_rules.xml"
if [[ ! -f "$RULES" ]]; then
  mkdir -p "$(dirname "$RULES")"
  cp -f "$ROOT/native-android/data_extraction_rules.xml" "$RULES" 2>/dev/null || cat > "$RULES" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup disableIfNoEncryptionCapabilities="true">
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </device-transfer>
</data-extraction-rules>
EOF
fi

GRADLE="$ROOT/android/app/build.gradle"
if [[ -f "$GRADLE" ]] && ! grep -q 'androidx.biometric:biometric' "$GRADLE"; then
  perl -i -pe 's|(implementation "androidx.core:core-splashscreen:[^"]+")|$1\n    implementation "androidx.biometric:biometric:1.1.0"|' "$GRADLE"
fi

(
  cd android
  ./gradlew assembleDebug
)

APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
mkdir -p "$ROOT/artifacts"
cp "$APK" "$ROOT/artifacts/handcash-mobile-debug.apk"
echo "APK ready: $ROOT/artifacts/handcash-mobile-debug.apk"
ls -la "$ROOT/artifacts/handcash-mobile-debug.apk"
