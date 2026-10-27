# ECPM shared-core integration

This shell enables BRC-229 through the exact Desktop SHA in
`ui-core-source.json`. ECPM crypto, permission scopes, the Aeon consent UI and
lock/account/revocation lifecycle live in `HANDCASH-DESKTOP/src/wallet/ecpm.ts`
and its existing permission queue. There is no Mobile copy of that code.

The shell resolves the same source-derived ECPM candidate artifact from the pinned Desktop tree.
Apps continue calling `getPublicKey` with
`protocolID: [2, 'p ecpm apply <compressed-point> mental poker deal']`,
`keyID` and `counterparty`; use `remove` with the returned point and the same
key scope to invert the operation. The response remains `{ publicKey }`.

ECPM consent is separate from Connect/Pay/identity proofs. The shared core shows
all protocol/counterparty/key/point/privilege information through the existing
Aeon approval flow. The user chooses once, a revocable memory-only session of up to 30 minutes, or remembered on-chain access with disclosed fees. Session consent
covers the reviewed exact feature/counterparty scope, including all key IDs/points and both operations, and is invalidated on lock,
account/network change and app permission revocation. Privileged calls also
require the engine's existing key policy; unavailable privileged hosts refuse.

`npm run test:ecpm` verifies the pinned Desktop commit and runs its real
cryptographic/production-dispatch contract plus this shell's app-tab relay test.
`npm test`, `npm run assert:ui-core` and `npm run build` retain the normal shell,
pin/typecheck and production-renderer gates. The PR workflow checks out both
repositories at the recorded SHA; no signing secrets or release job are used.

Merge/retain the paired Desktop PR first. If it is rebased or squash-merged,
update the Mobile pin to the reviewed resulting SHA and repeat the checks.
Source/build tests are not physical-device, signed APK/IPA or store acceptance.
Normal version bumps, native acceptance and publication remain maintainer work.

The paired Desktop core includes BRC-116 feature grouping, Action Label DPACP apply/read presentation and grant inventory/revocation, and Aeon lifetime controls. The app-tab and loopback contracts remain unchanged, and payment/money-key approvals retain their separate guards. The operator explicitly leaves the credential-dependent Jev UI review to HandCash maintainers.
