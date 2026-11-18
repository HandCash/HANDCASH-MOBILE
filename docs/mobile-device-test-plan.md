# Mobile device test plan for the migration candidate (packet E)

Task b32b4b93-61fc-4207-bafa-896def434d15. Companion to `docs/migration-verification-matrix.md`, which defines checks E1–E9 and the evidence fields. This file gives the device steps, adb commands, expected results and what to record.

Status: plan only. Nothing here has been run. No device is connected and adb is not installed on this machine.

## Approvals and stop conditions

Do not start Part B until every item is true:

1. Packets A–D local gates pass and a candidate APK is rebuilt from the pinned shared UI core.
2. The owner has given explicit approval to install the candidate and create a test wallet on the device.
3. A connected Android device with USB debugging is available and `adb devices` shows it as `device`.

Stop and report, without continuing, if any of these happen:

- A step would move funds, sweep a real wallet, or use a non-test account. That needs separate wallet-data and funds approval (E9 only).
- `adb` is asked to pull app data (`adb backup`, `run-as`, `pull` from the app sandbox). Do not do this. Evidence comes from the screen and filtered logs only.
- Any log line shows a seed, private key, token, or export secret. Stop, delete the log, and report the line type without its content.
- The device shows a prompt to export or paste keys that the expected results do not allow.

## Part A: prepare the candidate (no device)

Run on the build host. Each command only reads files or hashes them.

```bash
# Confirm the shared UI pin is clean and matches the source record
node scripts/assert-ui-core.mjs

# Record Mobile commit and version of the candidate
git rev-parse HEAD
node -p "require('./package.json').version"

# Record the shared UI pin used by the build
cat ui-core-pin.json
cat ui-core-source.json

# Hash the candidate APK and record the value in the evidence table
sha256sum handcash-mobile-<version>.apk

# Confirm the signing certificate (release builds: compare with HANDCASH_ANDROID_CERT_SHA256)
apksigner verify --print-certs handcash-mobile-<version>.apk
```

Expected: the pin check passes with `dirty: false`; the version matches the candidate; the APK hash matches its `.sha256` file if one is published; a release build's signer fingerprint equals the expected certificate. A debug build is not acceptable for E2 (upgrade over a release install) because its signing key differs.

## Part B: device run

Common setup, once per device:

```bash
adb devices -l                                  # expect one line ending in "device"
adb shell getprop ro.build.version.release      # Android version, record it
adb shell getprop ro.product.model              # device model, record it
adb shell pm list packages io.handcash.mobile   # package present or absent
adb shell dumpsys package io.handcash.mobile | grep -E 'versionName|versionCode|firstInstallTime|lastUpdateTime'
```

Log capture (start before each check, stop after; filter so secrets are not written):

```bash
adb logcat -c
# ... run the check ...
adb logcat -d -s HandCash:V Capacitor:V Console:V > logs/<check-id>.log
grep -iE 'seed|private|secret|token|mnemonic|wif|xprv' logs/<check-id>.log && echo "SECRET-LIKE LINE: stop and redact"
```

If the tag filter returns nothing, record "no log lines captured" and keep the check; do not skip it.

### E1 Fresh install

1. Remove any existing install: `adb uninstall io.handcash.mobile` (expect `Success`; if `Failure [DELETE_FAILED_INTERNAL_ERROR]` or similar, stop and report).
2. Install the candidate: `adb install handcash-mobile-<version>.apk` (expect `Success`).
3. Open the app; go to Onboarding and choose "Recover an old HandCash wallet".
4. Record the screen state and the log.

Expected: intent checkpoint is armed before any import; a new vault is created before any import is accepted; no old-app data is read.

### E2 Upgrade, install over

1. Install the baseline `0.1.819` APK: `adb install -r handcash-mobile-0.1.819.apk`. Check its hash: `f525a2b4…43bd`.
2. Create or use a test wallet on the baseline; note the wallet name and balance shown.
3. Force-stop and install the candidate over it: `adb install -r handcash-mobile-<version>.apk` (expect `Success`).
4. Confirm the new version: `adb shell dumpsys package io.handcash.mobile | grep versionCode`.
5. Open the app and unlock the same test wallet.

Expected: the same wallet unlocks; wallet data is intact; no prompt to export or paste keys. Secure-upgrade behaviour follows ef915996 criterion 5. Record whatever ef915996 requires, and mark it "not confirmed by owner" if its status is still open.

### E3 Upgrade from the old Flutter app

1. Install the old Flutter HandCash app (its package ID is not in this repo; take it from the handcash_mobile_app project) and sign in with a test account.
2. Install the candidate alongside it. If the package names are the same, this check cannot run as written; record "same package, E3 not applicable" and report it.
3. Start the candidate and go through the migration entry point.

Expected: the candidate does not read the old app's storage or tokens; migration happens only through a handcash.io export.

### E4 Cancel

1. Begin an export on handcash.io/migrate from the test account.
2. Cancel before completion.
3. In the app, open Import.

Expected: no source is saved; the pending request expires after 5 minutes; Import shows nothing new. Wait at least 5 minutes before the Import check.

### E5 Retry

1. Complete an export on handcash.io/migrate.
2. Force the response to be lost (for example, toggle airplane mode just after the export is sent, then restore it).
3. Retry the same export.
4. Count the saved sources in Import.

Expected: the source is saved exactly once; no duplicate receipt.

### E6 Offline

Airplane mode on the device:

```bash
adb shell cmd connectivity airplane-mode enable    # Android 9+; use Settings if this fails
```

1. Turn airplane mode on during "begin"; record the error text.
2. Turn it on during "complete"; record the error text.
3. Turn it on during the scan; then restore:

```bash
adb shell cmd connectivity airplane-mode disable
```

Expected: a named failure each time; no partial source saved; the scan resumes when online without duplicate work.

### E7 Cold restart

1. After a source is saved, stop the app: `adb shell am force-stop io.handcash.mobile`. Also swipe it away from recents.
2. Reopen the app; check the receipt persists.
3. Repeat with a kill during a scan.

Expected: the receipt persists; the scan resumes; preview and confirm are still required; nothing is moved.

### E8 Account switch

1. Begin an import on account A.
2. Switch or lock to account B before completion.
3. Check account B's wallet list and Import screen.

Expected: the request is rejected or bound to A; nothing appears in B; no secrets logged (run the log grep above).

### E9 Preview and confirm (funds approval only)

Do not run this check without separate wallet-data and funds approval.

1. Preview the sweep from the test account.
2. Confirm the sweep.
3. Record the miner verdict (txid accepted or rejected) and the resulting inventory.

Expected: the miner verdict and inventory are recorded. Collectables are shown as proven only from a complete BRC-150 record (packet D rule).

## What to record for each check

Copy this row into `docs/migration-verification-matrix.md` for each run:

| Field | Value |
|---|---|
| Check ID | E1–E9 |
| Device model and Android version | |
| Candidate version, commit, APK SHA-256 | |
| Shared UI pin (version, Desktop SHA, dirty) | |
| Steps actually taken | |
| Expected (copied from the matrix) | |
| Observed | |
| Pass / fail | |
| Log file name and grep result | |
| Screenshot file names (if any) | |
| Stop condition hit (none, or which) | |

Failed checks: attach the log bucket by manual upload. Do not paste logs with personal data into task evidence.

## Evidence on the task board

After each run, update task b32b4b93 with: the candidate SHA-256, the device model and Android version, the check IDs passed and failed, and the log file names. Do not mark the task done until E1–E8 have pass results, or failures are recorded and fixed, and E9 is either run with approval or explicitly marked not run.
