#!/usr/bin/env node
/**
 * Post-cap-sync Android patches (manifest, signing, version).
 * Replaces perl one-liners so Linux hosts can produce the same APK as macOS.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const androidRoot = path.join(mobileRoot, 'android')
const manifestPath = path.join(androidRoot, 'app/src/main/AndroidManifest.xml')
const gradlePath = path.join(androidRoot, 'app/build.gradle')
const nativeRoot = path.join(mobileRoot, 'native-android')
const keystorePath = path.join(nativeRoot, 'handcash-lab.keystore')
const rulesPath = path.join(androidRoot, 'app/src/main/res/xml/data_extraction_rules.xml')

function die(msg) {
  console.error(`[patch-android] ${msg}`)
  process.exit(1)
}

function read(p) {
  if (!fs.existsSync(p)) die(`missing ${p}`)
  return fs.readFileSync(p, 'utf8')
}

function write(p, src) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, src)
}

function patchManifest(src) {
  let m = src
  if (!m.includes('android.permission.CAMERA')) {
    m = m.replace(
      /<manifest([^>]*)>/,
      `<manifest$1>\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`,
    )
  }
  if (!m.includes('USE_BIOMETRIC')) {
    m = m.replace(
      /(<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" \/>)/,
      `$1\n    <uses-permission android:name="android.permission.USE_BIOMETRIC" />\n    <uses-permission android:name="android.permission.USE_FINGERPRINT" />`,
    )
  }
  if (!m.includes('FOREGROUND_SERVICE_DATA_SYNC')) {
    m = m.replace(
      /(<uses-permission android:name="android.permission.USE_FINGERPRINT" \/>)/,
      `$1\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />\n    <uses-permission android:name="android.permission.WAKE_LOCK" />`,
    )
  }
  if (!m.includes('DappBrowserActivity')) {
    m = m.replace(
      /(\s*)<provider/,
      `$1<activity
            android:name=".DappBrowserActivity"
            android:exported="false"
            android:label="@string/app_name"
            android:theme="@android:style/Theme.Material.NoActionBar"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"
            android:windowSoftInputMode="adjustResize" />
$1<provider`,
    )
  }
  if (!m.includes('AndroidForegroundService')) {
    m = m.replace(
      /<\/application>/,
      `        <receiver android:name="io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver" android:exported="false" />
        <service android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService" android:exported="false" android:foregroundServiceType="dataSync" />
    </application>`,
    )
  }
  if (!m.includes('usesCleartextTraffic')) {
    m = m.replace(/<application/, '<application android:usesCleartextTraffic="true"')
  }
  if (!m.includes('android:scheme="peerpay"')) {
    m = m.replace(
      /(\s*)<\/activity>/,
      `$1    <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="peerpay" />
            </intent-filter>
$1</activity>`,
    )
  }
  if (!m.includes('windowSoftInputMode')) {
    m = m.replace(
      /android:launchMode="singleTask"/,
      'android:launchMode="singleTask"\n            android:windowSoftInputMode="adjustPan"',
    )
  } else {
    m = m.replace(/android:windowSoftInputMode="adjustResize"/g, 'android:windowSoftInputMode="adjustPan"')
  }
  if (m.includes('android:allowBackup="true"')) {
    m = m.replace(/android:allowBackup="true"/, 'android:allowBackup="false"')
  }
  if (!m.includes('fullBackupContent')) {
    m = m.replace(
      /android:allowBackup="false"/,
      'android:allowBackup="false"\n        android:fullBackupContent="false"\n        android:dataExtractionRules="@xml/data_extraction_rules"',
    )
  }
  m = m.replace(
    /android:dataExtractionRules="\/data_extraction_rules"/g,
    'android:dataExtractionRules="@xml/data_extraction_rules"',
  )
  return m
}

function patchGradle(src, version, versionCode) {
  let g = src
  g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  g = g.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`)
  g = g.replace(/^undefined\s*$/gm, '')

  if (!g.includes('androidx.biometric:biometric')) {
    g = g.replace(
      /(implementation "androidx.core:core-splashscreen:[^"]+")/,
      `$1\n    implementation "androidx.biometric:biometric:1.1.0"`,
    )
  }

  if (fs.existsSync(keystorePath) && !g.includes('handcash-lab.keystore')) {
    g = g.replace(
      /android \{\n/,
      `android {
    signingConfigs {
        lab {
            storeFile file("../../native-android/handcash-lab.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
`,
    )
    g = g.replace(
      /buildTypes \{\n\s*release \{/,
      `buildTypes {
        debug {
            signingConfig signingConfigs.lab
        }
        release {`,
    )
  }

  return g
}

function ensureDataExtractionRules() {
  if (fs.existsSync(rulesPath)) return
  const template = path.join(nativeRoot, 'data_extraction_rules.xml')
  if (fs.existsSync(template)) {
    write(rulesPath, read(template))
    return
  }
  write(
    rulesPath,
    `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup disableIfNoEncryptionCapabilities="true">
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </device-transfer>
</data-extraction-rules>
`,
  )
}

function ensureLabKeystore() {
  if (fs.existsSync(keystorePath)) return true
  const fromEnv = process.env.HANDCASH_ANDROID_KEYSTORE?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) {
    fs.copyFileSync(fromEnv, keystorePath)
    console.log(`[patch-android] copied lab keystore from HANDCASH_ANDROID_KEYSTORE`)
    return true
  }
  return false
}

const mobilePkg = JSON.parse(read(path.join(mobileRoot, 'package.json')))
const version = mobilePkg.version
const parts = version.split('.').map(Number)
const versionCode = parts[0] * 10000 + parts[1] * 100 + parts[2]

const hasKeystore = ensureLabKeystore()
if (!hasKeystore) {
  console.warn(
    `[patch-android] WARNING: ${keystorePath} missing — debug APK will use this machine's ~/.android/debug.keystore.`,
  )
  console.warn(
    '[patch-android] Android blocks upgrades when the signing key differs (Mac vs Linux).',
  )
  console.warn(
    '[patch-android] Fix: on Mac run  bash scripts/export-lab-keystore.sh',
  )
  console.warn('[patch-android]       (copies ~/.android/debug.keystore — same key your Mac builds use)')
  console.warn('[patch-android]       copy that file to Linux, rebuild, or uninstall the old app first.')
}

write(manifestPath, patchManifest(read(manifestPath)))
write(gradlePath, patchGradle(read(gradlePath), version, versionCode))
ensureDataExtractionRules()

const nativeDst = path.join(androidRoot, 'app/src/main/java/io/handcash/mobile')
if (fs.existsSync(nativeRoot) && fs.existsSync(nativeDst)) {
  for (const name of fs.readdirSync(nativeRoot)) {
    if (!name.endsWith('.java')) continue
    fs.copyFileSync(path.join(nativeRoot, name), path.join(nativeDst, name))
  }
}

const resSrc = path.join(nativeRoot, 'res')
const resDst = path.join(androidRoot, 'app/src/main/res')
if (fs.existsSync(resSrc) && fs.existsSync(resDst)) {
  fs.cpSync(resSrc, resDst, { recursive: true })
}

console.log(`[patch-android] ok v${version} (${versionCode}) keystore=${hasKeystore ? 'lab' : 'local-debug'}`)
