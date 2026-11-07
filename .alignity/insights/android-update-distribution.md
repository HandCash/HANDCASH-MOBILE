---
name: android-update-distribution
when: preparing an Android user update
---
Use the installed app's GitHub Release discovery → Download → Android installer route, not file copying or adb; CI artifacts alone are invisible to phones.
Reuse verified signed artifacts and disclose missing pairing fixes before exact publication approval; GitHub release-created tags can trigger tag builds, so API creation alone does not prevent duplicate CI.
