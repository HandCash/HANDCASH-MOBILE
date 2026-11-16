# Migration verification matrix (packet E) — 2026-11-16

Task b32b4b93-61fc-4207-bafa-896def434d15, child of 50520c4a. Plan: `../HANDCASH-DESKTOP/docs/migration-remediation-plan.md`, packet E. Flow under test: `../HANDCASH-DESKTOP/docs/handcash-migration.md`.

This is a prepared matrix, not results. Nothing below has been run on a device.

## Baseline (current release, not the candidate)

| Field | Value |
|---|---|
| Mobile version / commit | 0.1.819 / `9985b60127955b66dcf5172f7afb8cfe540ccb08` (tag v0.1.819, origin/master) |
| APK | `handcash-mobile-0.1.819.apk` |
| APK SHA-256 | `f525a2b477920286dd4d5e450583ffe2846af63b142a71866eb6de2dad7843bd` (GitHub asset digest and `.sha256` agree) |
| Shared UI pin | `@handcash/wallet-ui` 1.3.713, Desktop `eee98f7c3a30e2845bc56543f81c10c7556af8ff`, `dirty: false` (release `ui-core-pin.json`, matches `ui-core-source.json`) |
| Migration code in pin | `cloudMigrationIntent.ts`, `import/encryptedImport.ts`, `docs/handcash-migration.md` present at `eee98f7c` |

The baseline predates packets A–D. The final run must use a new candidate built after A–D pass; fill the same fields for it below and do not reuse baseline evidence.

| Candidate field | Value |
|---|---|
| Mobile version / commit | _pending_ |
| APK SHA-256 / provenance | _pending_ |
| Shared UI pin (version, Desktop SHA, dirty) | _pending_ |
| A–D local gate evidence (task IDs, SHAs) | _pending_ |
| Installed build on device (Settings → About + `versionCode`) | _pending_ |

## Gates

1. **Disposable fixtures first:** packet B real-handler fixtures in shared `src/` cover wrong origin, expiry, identity/chain change, bad tag, replay, retry and account switch. Mobile adds shell fixtures only for failures reproduced on device; it never forks shared wallet panels.
2. **Install / test wallet:** device install and a test wallet need explicit approval.
3. **Real migration or sweep:** separate wallet-data/funds approval. Record miner verdict (txid accepted/rejected) and resulting inventory, not delivery success alone.

## Checks

Each row records: device + Android version, build SHA-256, steps, expected, observed, pass/fail, log bucket (manual upload) if failed.

| # | Check | Steps | Expected |
|---|---|---|---|
| E1 | Fresh install | Install candidate on clean device; Onboarding → Recover an old HandCash wallet | Intent checkpoint armed; new vault created before any import; no old-app data read |
| E2 | Upgrade (install-over) | Install baseline 0.1.819 with test wallet; `adb install -r` candidate | Same wallet unlocks; DurableStore data intact; no silent prompt to export/paste keys; secure-upgrade behaviour per ef915996 criterion 5 |
| E3 | Upgrade from old HandCash (Flutter) | Old app installed with test account; install candidate alongside | No reading of old app storage/tokens; migration only via handcash.io export |
| E4 | Cancel | Begin export on handcash.io/migrate, cancel before completion | No source saved; pending request expires (5 min); Import shows nothing new |
| E5 | Retry | Complete export, force lost response, retry same export | Source saved exactly once; no duplicate receipt |
| E6 | Offline | Airplane mode during begin, during complete, and during scan | Named failure, no partial source; scan resumes when online without duplicate work |
| E7 | Cold restart | Kill app (swipe + force-stop) after source saved, and mid-scan | Receipt persists; scan resumes; preview/confirm still required; nothing moved |
| E8 | Account switch | Begin import on account A, switch/lock to account B before completion | Request rejected or bound to A; nothing appears in B; no secrets logged |
| E9 | Preview → confirm (funds approval only) | Confirm sweep from test account | Miner verdict and inventory recorded; collectables proof per packet D (proven only from complete BRC-150) |

## Coordination

- ef915996 (secure Mobile upgrade, criterion 5) owns detection and its docs; E2/E3 verify it, they do not change it. Its owner chat cmwe8jpbi5z did not answer within two minutes; its last evidence reports Desktop release-merge conflicts blocking its tests. Status of criterion 5 inside `eee98f7c` is confirmed only by file presence, not by its owner.
- Desktop counterpart records native persistence on its supported platforms; platforms not run stay unverified. iOS is not covered by this matrix.

## Current blockers

- Packets A–D local gates not passed (dependency).
- No device connected and `adb` not installed on this machine.
- Install/test-wallet and wallet-data/funds approvals not yet given.
