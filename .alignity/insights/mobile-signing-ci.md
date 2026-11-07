---
name: mobile-signing-ci
when: checking Mobile signing or preparing a launch build
---
Check GitHub secret names and existing successful APK runs before calling missing local signing values a blocker; never read secret values or rebuild an existing verified artifact.
The deployed release workflow auto-publishes; use an installed, tested artifact-only manual path or obtain publication approval before dispatching it.
