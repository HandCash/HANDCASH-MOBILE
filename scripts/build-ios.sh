#!/usr/bin/env bash
# Archive HandCash Mobile for iOS and, with HANDCASH_IOS_UPLOAD=1, send it to
# App Store Connect for TestFlight. The iOS counterpart of build-apk.sh.
#
# Signing is automatic through an App Store Connect API key, so no
# certificate or profile lives on this Mac or in the repo:
#   HANDCASH_IOS_TEAM_ID     Apple Developer team (10 characters)
#   HANDCASH_ASC_KEY_ID      API key id
#   HANDCASH_ASC_ISSUER_ID   API key issuer id
#   HANDCASH_ASC_KEY_PATH    .p8 file (default ~/.handcash/ios-signing/AuthKey_<id>.p8)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "[build-ios] $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "iOS builds need macOS"
DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
[[ "$DEV_DIR" == *.app/Contents/Developer ]] \
  || die "full Xcode is required (found '${DEV_DIR:-none}'): install it from the App Store, then sudo xcode-select -s /Applications/Xcode.app"
xcodebuild -version >/dev/null || die "xcodebuild cannot run — open Xcode once to accept the licence"
xcodebuild -showsdks 2>/dev/null | grep -q iphoneos \
  || die "the iOS platform is not installed: xcodebuild -downloadPlatform iOS"

: "${HANDCASH_IOS_TEAM_ID:?Set HANDCASH_IOS_TEAM_ID (Apple Developer team id)}"
: "${HANDCASH_ASC_KEY_ID:?Set HANDCASH_ASC_KEY_ID (App Store Connect API key id)}"
: "${HANDCASH_ASC_ISSUER_ID:?Set HANDCASH_ASC_ISSUER_ID (App Store Connect API issuer id)}"
KEY_PATH="${HANDCASH_ASC_KEY_PATH:-$HOME/.handcash/ios-signing/AuthKey_${HANDCASH_ASC_KEY_ID}.p8}"
[[ -f "$KEY_PATH" ]] || die "API key $KEY_PATH not found"
export HANDCASH_IOS_TEAM_ID

npm ci

# Fail closed unless sibling Desktop UI core is pinned (version + git SHA).
node "$ROOT/scripts/assert-ui-core.mjs"
bash "$ROOT/scripts/test-ios-native.sh"

npm run build
CAP="node node_modules/@capacitor/cli/bin/capacitor"
if [[ ! -d ios ]]; then
  # The CLI picks CocoaPods vs SPM before the project exists, so `add` ends in
  # a failed pod install; the sync below sees CapApp-SPM and finishes it.
  $CAP add ios --packagemanager SPM || [[ -d ios/App/CapApp-SPM ]] || die "cap add ios failed"
fi
[[ -d ios/App/CapApp-SPM ]] || die "ios/ is a CocoaPods project; delete ios/ and rebuild (it is generated)"
$CAP sync ios

node "$ROOT/scripts/patch-ios.mjs"

MOBILE_VERSION="$(node -p "require('./package.json').version")"
BUILD="$ROOT/ios/build"
ARCHIVE="$BUILD/HandCash-${MOBILE_VERSION}.xcarchive"
rm -rf "$ARCHIVE" "$BUILD/export"
mkdir -p "$BUILD"

AUTH=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$KEY_PATH"
  -authenticationKeyID "$HANDCASH_ASC_KEY_ID"
  -authenticationKeyIssuerID "$HANDCASH_ASC_ISSUER_ID"
)

xcodebuild archive \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  "${AUTH[@]}"

DESTINATION=export
[[ "${HANDCASH_IOS_UPLOAD:-0}" == "1" ]] && DESTINATION=upload
cat >"$BUILD/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${DESTINATION}</string>
  <key>teamID</key><string>${HANDCASH_IOS_TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$BUILD/export" \
  -exportOptionsPlist "$BUILD/ExportOptions.plist" \
  "${AUTH[@]}"

mkdir -p "$ROOT/artifacts"
node "$ROOT/scripts/assert-ui-core.mjs" --out "artifacts/handcash-mobile-${MOBILE_VERSION}.ios.ui-core-pin.json"
if [[ "$DESTINATION" == "upload" ]]; then
  echo "[build-ios] uploaded ${MOBILE_VERSION} — it appears in TestFlight once App Store Connect finishes processing"
else
  IPA="$(ls "$BUILD"/export/*.ipa)"
  OUT="$ROOT/artifacts/handcash-mobile-${MOBILE_VERSION}.ipa"
  cp "$IPA" "$OUT"
  echo "$(shasum -a 256 "$OUT" | awk '{print $1}')  $(basename "$OUT")" | tee "$OUT.sha256"
  echo "[build-ios] IPA ready: $OUT (HANDCASH_IOS_UPLOAD=1 sends it to TestFlight)"
fi
