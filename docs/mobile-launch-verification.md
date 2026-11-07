# Mobile launch verification — 2026-11-06

## Candidate

Mobile 0.1.777 consumes committed Desktop c57b4473fb0eaad3750831fa83e5e255c4f46d0e / UI 1.3.663. This is a local, unpublished candidate, not a shipped APK. Preserve Mobile 154682d.

The candidate includes Desktop 1f05396a: receiver-generated six-digit pairing code, typed on the approver, three attempts, two-minute expiry and nonce replay protection. LAN and sealed-messagebox routes use the same receiver checks. The pairing chart ignores pasted/autofilled multi-character changes. The receiver's vault gate requires confirmation before decryption/delivery.

## Safe evidence

- Existing GitHub production-signing secret names are present; values were not read. Release workflow run 42229175175 succeeded for f199863 / Mobile 0.1.776. No CI was dispatched and no release was created or changed here.
- Downloaded existing 0.1.776 APK, checksum and provenance into ignored `artifacts/released-0.1.776/`; SHA-256 check passed. Its provenance identifies Desktop 01034869 / UI 1.3.661. That commit does **not** contain typed-code fix 1f05396a. Do not treat this existing APK as verification of the candidate.
- Known Android upload bucket: `hc-a580a83ef98f5463f546`, manual upload 2026-11-06T13:36:07.621Z, Mobile 0.1.774. At 05:49:22Z and 12:12:53Z Android scanned Linux PC; it reached the relay and logged vault sent at 05:49:39Z and 12:13:02Z. Earlier LAN hello attempts timed out. These are delivery facts, not usable Linux-session proof.
- Known desktop upload bucket `hc-ad7afbfaae0d01fffcb3` ends on 2026-10-23 (Darwin 1.3.637), not the Linux receiver. Known phone bucket ends September 6. No current receiver-side upload or opposite-direction session proof is available in these sources.
- USB sysfs and device nodes expose only seven host controllers/root hubs: no USB phone is connected. adb is absent. No installation was attempted; wireless device availability was not established.

## Verification

Pinned Desktop typecheck passed. Focused shared suites: 89 passing tests across scan protocol, pairing and relay charts, email relay, unlock chart, vault/account holding, signed holder records and vault transfer. Mobile: 37 tests passed, including manual CI artifact-only guards. The candidate Mobile typecheck and production bundle passed; Vite completed in 20.52 seconds with a large-chunk warning. The handoff patch passes `git apply --check --unidiff-zero` against the selected clean Desktop core.

## Remaining cross-project work

The shared approver still displays `Signed in on …` after an HTTP vault-delivery acknowledgment, before the receiving device saves or boots the wallet. Email relay also labels both `sent` and `received` as signed in. Mobile's external-file protection refused changes to those Desktop files; no bypass was attempted. `launch-signin-delivery.patch` contains a minimal truthful-copy correction and adjusted assertions for the Desktop owner. It does not add a usable-session receipt or prove receiver boot success.

Desktop must make its selected core available remotely (GitHub commit lookup for c57b4473 returned 422), apply the delivery-label correction, verify it there, and provide a final committed pin. Mobile only consumes that committed shared core.

The staged APK workflow supports manual artifact-only builds (`publish: false`, the default), including dispatch against a tag. Tag pushes retain existing publishing behavior; manual `publish: true` explicitly publishes. Do not dispatch the currently deployed old workflow: it auto-publishes. Installing this staged workflow remotely and authorizing its build remain external actions; new signing credentials are not required.

## Device acceptance still required

Test both roles: signed-in Mobile scans fresh Desktop; signed-in Desktop scans fresh Mobile. On each route, type the receiver's code on the approver; wrong code must not send a vault. After approval, verify the receiver saves, boots and opens a usable wallet and survives restart. Check Identity/Friends in the opened wallet. Repeat across separate networks. If it fails, manually upload the receiver's logs so the receiving side can be correlated with delivery. Do not equate delivery, an account record, or the approver's status text with a usable session.
