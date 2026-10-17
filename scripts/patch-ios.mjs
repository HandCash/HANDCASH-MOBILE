#!/usr/bin/env node
/**
 * Post-cap-sync iOS patches: native sources, plugin host, Info.plist, version,
 * signing team. The iOS counterpart of patch-android.mjs; `ios/` is generated
 * and gitignored, everything it needs lives in `native-ios/`.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import plist from 'plist'

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = path.join(mobileRoot, 'ios/App/App')
const projectPath = path.join(mobileRoot, 'ios/App/App.xcodeproj/project.pbxproj')
const infoPath = path.join(appRoot, 'Info.plist')
const storyboardPath = path.join(appRoot, 'Base.lproj/Main.storyboard')
const nativeRoot = path.join(mobileRoot, 'native-ios')
const BUNDLE_ID = 'io.handcash.mobile'
const HOST_CLASS = 'HandCashBridgeViewController'

function die(msg) {
  console.error(`[patch-ios] ${msg}`)
  process.exit(1)
}

function read(p) {
  if (!fs.existsSync(p)) die(`missing ${p}`)
  return fs.readFileSync(p, 'utf8')
}

/** Stable 24-hex object id, so re-running never adds a second reference. */
function objectId(seed) {
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24).toUpperCase()
}

function insertAfter(src, marker, text) {
  const at = src.indexOf(marker)
  if (at < 0) die(`project.pbxproj has no "${marker.trim()}"`)
  return src.slice(0, at + marker.length) + text + src.slice(at + marker.length)
}

/** Add each Swift file to the App group and the App target's Sources phase. */
function addSources(project, names) {
  const delegateRef = /(\w{24}) \/\* AppDelegate\.swift \*\/ = \{isa = PBXFileReference/.exec(project)?.[1]
  const delegateBuild = /(\w{24}) \/\* AppDelegate\.swift in Sources \*\/ = \{isa = PBXBuildFile/.exec(project)?.[1]
  if (!delegateRef || !delegateBuild) die('AppDelegate.swift is not in the project; regenerate ios/')
  let p = project
  for (const name of names) {
    if (p.includes(`path = ${name};`)) continue
    const ref = objectId(`ref:${name}`)
    const build = objectId(`build:${name}`)
    p = insertAfter(
      p,
      '/* Begin PBXBuildFile section */\n',
      `\t\t${build} /* ${name} in Sources */ = {isa = PBXBuildFile; fileRef = ${ref} /* ${name} */; };\n`,
    )
    p = insertAfter(
      p,
      '/* Begin PBXFileReference section */\n',
      `\t\t${ref} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${name}; sourceTree = "<group>"; };\n`,
    )
    p = insertAfter(p, `\t\t\t\t${delegateRef} /* AppDelegate.swift */,\n`, `\t\t\t\t${ref} /* ${name} */,\n`)
    p = insertAfter(
      p,
      `\t\t\t\t${delegateBuild} /* AppDelegate.swift in Sources */,\n`,
      `\t\t\t\t${build} /* ${name} in Sources */,\n`,
    )
  }
  return p
}

function patchBuildSettings(project, version, build, team) {
  let p = project
  p = p.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID};`)
  p = p.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  p = p.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`)
  // iPhone only for the beta: an iPad build needs its own layout review and screenshots.
  p = p.replace(/TARGETED_DEVICE_FAMILY = [^;]+;/g, 'TARGETED_DEVICE_FAMILY = 1;')
  if (team) {
    p = p.replace(/\t*DEVELOPMENT_TEAM = [^;]+;\n/g, '')
    p = p.replace(/(\t*)CODE_SIGN_STYLE = Automatic;\n/g, `$1CODE_SIGN_STYLE = Automatic;\n$1DEVELOPMENT_TEAM = ${team};\n`)
  }
  return p
}

function patchInfo(src) {
  const info = plist.parse(src)
  info.CFBundleDisplayName = 'HandCash'
  info.NSFaceIDUsageDescription = 'Face ID unlocks your HandCash wallet on this iPhone.'
  info.NSCameraUsageDescription = 'The camera scans payment and pairing QR codes.'
  info.NSPhotoLibraryAddUsageDescription = 'HandCash saves QR codes and item images you choose to Photos.'
  // Vendor-neutral BRC schemes the wallet claims from the OS. Must stay in step
  // with `decideWalletDeepLink` and patch-android.mjs.
  info.CFBundleURLTypes = [
    { CFBundleURLName: `${BUNDLE_ID}.brc`, CFBundleURLSchemes: ['peerpay', 'brc29'] },
  ]
  // Answer recorded once in App Store Connect; set it here so every upload skips the question.
  const exempt = process.env.HANDCASH_IOS_USES_NON_EXEMPT_ENCRYPTION?.trim()
  if (exempt === 'true' || exempt === 'false') info.ITSAppUsesNonExemptEncryption = exempt === 'true'
  info.UISupportedInterfaceOrientations = ['UIInterfaceOrientationPortrait']
  delete info['UISupportedInterfaceOrientations~ipad']
  return plist.build(info)
}

function patchStoryboard(src) {
  return src.replace(
    /customClass="CAPBridgeViewController" customModule="Capacitor"/,
    `customClass="${HOST_CLASS}" customModule="App" customModuleProvider="target"`,
  )
}

function copyArt() {
  const res = path.join(nativeRoot, 'res')
  const icon = path.join(res, 'AppIcon-1024.png')
  const splash = path.join(res, 'splash-2732x2732.png')
  if (!fs.existsSync(icon) || !fs.existsSync(splash)) die('missing native-ios/res art; run python3 scripts/gen-ios-icons.py')
  const iconSet = path.join(appRoot, 'Assets.xcassets/AppIcon.appiconset')
  for (const name of fs.readdirSync(iconSet)) {
    if (name.endsWith('.png')) fs.rmSync(path.join(iconSet, name))
  }
  fs.copyFileSync(icon, path.join(iconSet, 'AppIcon-1024.png'))
  fs.writeFileSync(
    path.join(iconSet, 'Contents.json'),
    `${JSON.stringify(
      {
        images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
        info: { author: 'xcode', version: 1 },
      },
      null,
      2,
    )}\n`,
  )
  const splashSet = path.join(appRoot, 'Assets.xcassets/Splash.imageset')
  for (const name of fs.readdirSync(splashSet)) {
    if (name.endsWith('.png')) fs.copyFileSync(splash, path.join(splashSet, name))
  }
}

if (!fs.existsSync(appRoot)) die('ios/ is missing; run `npx cap add ios --packagemanager SPM` first')

const mobilePkg = JSON.parse(read(path.join(mobileRoot, 'package.json')))
const version = mobilePkg.version
const parts = version.split('.').map(Number)
// Same number as the Android versionCode; App Store Connect needs it to grow per upload.
const build = parts[0] * 10000 + parts[1] * 100 + parts[2]
const team = process.env.HANDCASH_IOS_TEAM_ID?.trim() || ''

const sources = fs.readdirSync(nativeRoot).filter((name) => name.endsWith('.swift')).sort()
for (const name of sources) fs.copyFileSync(path.join(nativeRoot, name), path.join(appRoot, name))

let project = read(projectPath)
project = addSources(project, sources)
project = patchBuildSettings(project, version, build, team)
fs.writeFileSync(projectPath, project)
fs.writeFileSync(infoPath, patchInfo(read(infoPath)))
const storyboard = patchStoryboard(read(storyboardPath))
if (!storyboard.includes(`customClass="${HOST_CLASS}"`)) die('Main.storyboard has no CAPBridgeViewController scene to replace')
fs.writeFileSync(storyboardPath, storyboard)
copyArt()

console.log(`[patch-ios] ok v${version} (${build}) bundle=${BUNDLE_ID} team=${team || 'unset'} sources=${sources.length}`)
