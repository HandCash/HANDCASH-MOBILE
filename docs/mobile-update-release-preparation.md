# Android update release preparation — 2026-11-07

## Distribution verified

The public, unauthenticated GitHub releases endpoint returned HTTP 200 and latest
v0.1.776 with the expected APK asset. `src/mobileUpdate.ts` polls this feed, not CI
artifacts. Automatic mode checks four seconds after app startup and every four
hours while running; Settings → Check update checks immediately in Automatic or
Manual mode. Off disables checks. An available-update notice offers Download;
`SystemBrowser.open` hands the APK URL to the OS browser/download manager. The
person opens the completed download and confirms Android's installer, granting
that browser install permission if Android requests it, then reopens HandCash.
No manual file copying or adb is part of this normal route. It is not silent OTA.
Actual phone update mode, installed version, signer and installer behavior have
not been observed. Never uninstall the wallet to overcome a signing error.

## Existing artifact: preserve, do not rebuild

- Run: https://github.com/HandCash/HANDCASH-MOBILE/actions/runs/42336112118
- Mobile source: bfb27bc43762150b15a52b97118a2e4a0d8fad54, version 0.1.777.
- Shared core: c57b4473fb0eaad3750831fa83e5e255c4f46d0e / UI 1.3.663, clean provenance.
- APK: `artifacts/candidate-0.1.777/handcash-mobile-0.1.777.apk`.
- SHA-256: `22151c0fc7f9a9fc619f8a693754489b25464f64ae938846ee1e89cd2566d637`.
- Checksum/archive checks passed; CI verified production signing rotation for
  Android 6–8 and Android 9+. Both publication steps were skipped.
- APK chat confirms the same run and its separate download; no duplicate build.

## Pending Desktop handoff: release gate

The canonical Desktop worktree has uncommitted signed-receipt changes, absent
from this APK: scanLogin payload/approver/receiver/relay/approvals, device peer
handler/server, AuthScreen, DeviceSignInPanel and pairing chart/tests. Its
`docs/device-pairing-verification.md` records focused protocol/chart checks,
synthetic live Worker verification and broader checks, but no physical two-device
success. The receipt binds both ephemeral peer keys and the ciphertext hash;
it is sent only after persistence, account holding and wallet runtime startup.
Missing/invalid receipts and older peers fail closed. Both apps need compatible
receipt-capable builds; shipping only one side can intentionally refuse pairing.

The two available Desktop/APK chat snapshots do not identify a committed receipt
handoff or its active owner. Preserve all unrelated canonical Desktop edits,
including crypto, licensing, Settings and migration work. Do not package that dirty
tree, bypass external-file protection, or silently substitute it into the pin.
Desktop's owner must isolate and commit the receipt fix, provide its SHA/version
and relevant tests, and make that exact source available for CI with approval.
Then Mobile can update its committed pin and produce one new artifact-only signed
candidate. The current native bridge's 120-second deadline exceeds the receipt
receiver's 90-second setup timeout and approver's 100-second wait; no Mobile
native deadline change is needed based on the inspected code.

## Available checks completed here

Ten focused Mobile tests passed, covering release discovery, publication visibility,
signing preflight and artifact-only CI guards. Forty-seven tests passed against
Desktop's pending working tree: scan protocol, the real pairing chart and native
peer request dispatch. These results validate the inspected pending source, not
its inclusion in the existing APK. The APK checksum still passes. Update discovery
and system-browser handoff source are unchanged since Mobile 154682d.

## Publication scope to approve only after the gate clears

Before any publication, show the exact final Mobile commit, Desktop pin, version,
APK hash and compatibility limits and obtain explicit approval to:

1. Create the matching version tag and public GitHub Release in
   `HandCash/HANDCASH-MOBILE`, marking it Latest.
2. Attach only the already verified production APK, its `.apk.sha256` and
   `.ui-core-pin.json`; do not replace existing release assets or delete releases.
3. Make that version discoverable to installed Android wallets through their
   existing update feed. No app-store upload, Desktop release, secret movement,
   default-branch push or additional build is covered by this scope.

The existing release workflow rebuilds before publishing. To avoid a duplicate
build, publish the verified artifact directly after exact approval, using the
same tag/title/Latest and three-asset convention. A tag push triggers CI, so do
not push a tag just to publish an already built artifact. Create the release/tag
through GitHub's release API/CLI with the exact approved source target instead.
No publication approval has been requested for the stale receipt-less candidate;
no release, tag, default branch or secret was changed during this preparation.
