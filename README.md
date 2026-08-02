# HandCash Mobile

Isolated mobile shell of HandCash Desktop: same brand language, **Scan to link** (Telegram-style) from an unlocked Desktop on the same Wi‑Fi.

Desktop side: **Settings → Link device**.

## Develop (browser)

```bash
npm install
npm run dev
```

## Build debug APK

Requires **JDK 21+** (Capacitor 7) and Android SDK.

```bash
bash scripts/build-apk.sh
# → artifacts/handcash-mobile-debug.apk
```

The script downloads a portable Temurin JDK 21 and Android cmdline-tools into `~/.local` if needed (no sudo).

## Link flow

1. Desktop unlocked → Settings → **Link device** → password → QR  
2. Phone + Desktop on same LAN  
3. Mobile → **Scan to link** → set phone password → same wallet locally  
4. History sync URL from Desktop is copied when set (BRC-39)
