# Mobile sign-in refusal — 2026-11-07

## Safe evidence

- Latest uploaded Android session: manual upload at 05:16:39.850 UTC, app 0.1.777. Raw logs, keys, codes, account identifiers and tokens are not retained here.
- 05:16:12.580: scan-login scanned the Linux receiver.
- 05:16:14.874: scan-login reached the relay.
- No confirmation-rejection reason, vault-sent, or approve-failed event appears in this upload. This does not establish a usable receiver session.
- A nearby cloud-backup refusal is the BRC-38 export-size budget (over 64 MB), not an observed pairing rejection. Treat it separately; do not delete wallet history to address this report.
- Local USB inventory has only host controllers, no phone; adb is unavailable. Uploaded version evidence is not a live package/device inspection.

## Diagnostic gap and next fix

The published shared UI pin c57b4473 maps pairing confirmation `locked`, `code-expired`, and unknown responses to a refused row. Unknown errors collapse to `ended`. `confirmScanLoginCode` does not log these reasons; explicit refusal also produces the same row without a diagnostic event. Therefore the generic “Sign-in refused” label and this upload cannot distinguish expiration, attempt lockout, explicit cancellation, or an unrecognized response.

Desktop/shared sign-in owner should preserve a safe allowlisted reason and HTTP status in confirmation diagnostics (never code, proof, secret, key, request body or arbitrary server response), distinguish unknown/transport failure from a receiver-ended session, and test the mappings. Collect the matching Linux receiver log for this attempt before assigning a root cause. The pending signed-receipt fix remains a separate requirement for proving successful session establishment; it is absent from 0.1.777.

The known Desktop uploaded-log bucket is stale (2026-10-23, Darwin), not the Linux receiver. The available Desktop chat target was unavailable when queried; no current receiver evidence was obtained. Do not overwrite the existing dirty shared-UI work to apply a speculative fix.

## Preservation

No installed-app data was changed, no reinstall/build was run, and no signing secrets were read or moved. A fresh receiver code is a non-destructive retry, but is not a verified fix. A matching Linux log and the detailed message below the refused row are needed to narrow this attempt further.
