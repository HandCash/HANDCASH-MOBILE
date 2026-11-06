---
name: shared-signin-ownership
when: changing sign-in or preparing a Mobile release
---
Shared sign-in belongs to HANDCASH-DESKTOP chat #183; Mobile only consumes its committed UI pin and handles build integration and device verification.
Preserve Mobile 154682d; inspect existing APKs and running builds before starting another, and never report vault delivery as a verified usable device session.
