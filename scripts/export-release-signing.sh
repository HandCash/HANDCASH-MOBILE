#!/usr/bin/env bash
# Run on the Mac that still has production Android signing — BEFORE wiping it.
# Users on 0.1.764+ trust CN=HandCash Wallet (4a0dae…). Lab/debug APKs cannot
# upgrade them. This pushes the release .p12 + password into GitHub Actions so
# Linux CI can ship the same lineage as 0.1.764 (Mac/debug → HandCash Wallet).
set -euo pipefail

REPO="${HANDCASH_MOBILE_REPO:-HandCash/HANDCASH-MOBILE}"
NEXT_KS="${HANDCASH_ANDROID_NEXT_KEYSTORE:-$HOME/.handcash/android-signing/handcash-release.p12}"
NEXT_ALIAS="${HANDCASH_ANDROID_NEXT_KEY_ALIAS:-handcash-release}"
PARENT_KS="${HANDCASH_ANDROID_KEYSTORE:-$HOME/.android/debug.keystore}"

die() { echo "[export-release-signing] $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "run this on the Mac that holds the release key"
command -v gh >/dev/null || die "gh CLI required (authenticated to $REPO)"
[[ -f "$NEXT_KS" ]] || die "missing $NEXT_KS — restore handcash-release.p12 from backup before erase"
[[ -f "$PARENT_KS" ]] || die "missing parent keystore $PARENT_KS (lineage root = Mac debug cert b6de…)"

NEXT_PASS="${HANDCASH_ANDROID_NEXT_STORE_PASSWORD:-$(security find-generic-password -s handcash-android-release -a "$NEXT_ALIAS" -w 2>/dev/null || true)}"
[[ -n "$NEXT_PASS" ]] || die "password not in env or Keychain (service handcash-android-release, account $NEXT_ALIAS)"

PARENT_PASS="${HANDCASH_ANDROID_STORE_PASSWORD:-android}"
PARENT_ALIAS="${HANDCASH_ANDROID_KEY_ALIAS:-androiddebugkey}"
PARENT_KEY_PASS="${HANDCASH_ANDROID_KEY_PASSWORD:-android}"
PARENT_SHA="${HANDCASH_ANDROID_CERT_SHA256:-b6de8e22d0cf9bf4a01c0f60e004a98de8d1e9a1f611adaf9945b38498f64ec4}"
NEXT_SHA="${HANDCASH_ANDROID_NEXT_CERT_SHA256:-4a0dae371b99461cc6db57c63d7105cb9ffde34d3bb6b3f4dbfaa148442d8c4e}"

echo "Uploading production signing secrets to $REPO …"
echo "  parent: $PARENT_KS ($PARENT_ALIAS → $PARENT_SHA)"
echo "  next:   $NEXT_KS ($NEXT_ALIAS → $NEXT_SHA)"

base64 < "$PARENT_KS" | tr -d '\n' | gh secret set HANDCASH_ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$PARENT_PASS" | gh secret set HANDCASH_ANDROID_STORE_PASSWORD --repo "$REPO"
printf '%s' "$PARENT_ALIAS" | gh secret set HANDCASH_ANDROID_KEY_ALIAS --repo "$REPO"
printf '%s' "$PARENT_KEY_PASS" | gh secret set HANDCASH_ANDROID_KEY_PASSWORD --repo "$REPO"
printf '%s' "$PARENT_SHA" | gh secret set HANDCASH_ANDROID_CERT_SHA256 --repo "$REPO"

base64 < "$NEXT_KS" | tr -d '\n' | gh secret set HANDCASH_ANDROID_NEXT_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$NEXT_PASS" | gh secret set HANDCASH_ANDROID_NEXT_STORE_PASSWORD --repo "$REPO"
printf '%s' "$NEXT_ALIAS" | gh secret set HANDCASH_ANDROID_NEXT_KEY_ALIAS --repo "$REPO"
printf '%s' "$NEXT_SHA" | gh secret set HANDCASH_ANDROID_NEXT_CERT_SHA256 --repo "$REPO"

# Offline copy for Linux (never commit)
mkdir -p "$HOME/.handcash/android-signing"
chmod 700 "$HOME/.handcash/android-signing"
cp -f "$NEXT_KS" "$HOME/.handcash/android-signing/handcash-release.p12"
chmod 600 "$HOME/.handcash/android-signing/handcash-release.p12"
echo "Also kept a local copy at ~/.handcash/android-signing/handcash-release.p12"
echo "scp that file to your Linux box, then: tag a release — CI ships production-lineage APKs."
echo "Done. Do not wipe the Mac until you have confirmed a CI APK verifies Android 9+=$NEXT_SHA"
