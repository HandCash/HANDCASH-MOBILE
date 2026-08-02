# HandCash Mobile

**Same wallet as Desktop** — this app mounts `HANDCASH-DESKTOP/src/App` inside Capacitor with a thin `window.handcash` bridge (localStorage durable prefs, no Electron).

Requires sibling checkout:

```
handcash/
  HANDCASH-DESKTOP/
  HANDCASH-MOBILE/   ← you are here
```

## Develop

```bash
npm install
npm run dev          # http://localhost:5174 — full Desktop UI
```

## APK

```bash
bash scripts/build-apk.sh
# → artifacts/handcash-mobile-debug.apk
```

## What differs from Desktop

| Feature | Mobile |
|---------|--------|
| UI / vault / backups / link device | Same Desktop code |
| BRC-100 LAN bridge | Stubbed (Desktop hosts the bridge) |
| OS keychain seal | Not available — password wrap only |
| Auto-update | Sideload / store |
| Device link | Embedded QR show + camera scan (same as Desktop) |
