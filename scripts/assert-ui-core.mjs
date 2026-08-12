#!/usr/bin/env node
/**
 * Prove Mobile is building against a named Desktop UI-core checkout.
 *
 * Writes artifacts/ui-core-pin.json (and optional --out path). Fails closed when
 * the sibling Desktop tree is missing, the @handcash/wallet-ui package is
 * absent, versions disagree, or the Desktop worktree is dirty (unless
 * ALLOW_DIRTY_UI_CORE=1).
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopRoot = path.resolve(mobileRoot, '../HANDCASH-DESKTOP')
const uiPkgPath = path.join(desktopRoot, 'packages/wallet-ui/package.json')
const desktopPkgPath = path.join(desktopRoot, 'package.json')
const mobilePkgPath = path.join(mobileRoot, 'package.json')

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outPath =
  outIdx >= 0 && args[outIdx + 1]
    ? path.resolve(mobileRoot, args[outIdx + 1])
    : path.join(mobileRoot, 'artifacts/ui-core-pin.json')

function die(msg) {
  console.error(`[ui-core] ${msg}`)
  process.exit(1)
}

function git(cwd, cmd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

if (!fs.existsSync(desktopRoot)) {
  die(`Desktop sibling missing at ${desktopRoot}`)
}
if (!fs.existsSync(uiPkgPath)) {
  die(`@handcash/wallet-ui missing — expected ${uiPkgPath}`)
}
if (!fs.existsSync(desktopPkgPath)) {
  die(`Desktop package.json missing at ${desktopPkgPath}`)
}

const uiPkg = JSON.parse(fs.readFileSync(uiPkgPath, 'utf8'))
const desktopPkg = JSON.parse(fs.readFileSync(desktopPkgPath, 'utf8'))
const mobilePkg = JSON.parse(fs.readFileSync(mobilePkgPath, 'utf8'))

if (uiPkg.name !== '@handcash/wallet-ui') {
  die(`wallet-ui package name is ${uiPkg.name}, expected @handcash/wallet-ui`)
}
if (uiPkg.version !== desktopPkg.version) {
  die(
    `UI core ${uiPkg.version} ≠ Desktop ${desktopPkg.version} — bump packages/wallet-ui with Desktop`,
  )
}

const sha = git(desktopRoot, 'git rev-parse HEAD')
const short = git(desktopRoot, 'git rev-parse --short HEAD')
const branch = git(desktopRoot, 'git rev-parse --abbrev-ref HEAD')
const dirty = Boolean(git(desktopRoot, 'git status --porcelain'))
const allowDirty = process.env.ALLOW_DIRTY_UI_CORE === '1'

if (dirty && !allowDirty) {
  die(
    `Desktop worktree is dirty (sha ${short}). Commit/stash Desktop first, or set ALLOW_DIRTY_UI_CORE=1 for a local experiment.`,
  )
}

const pin = {
  schema: 1,
  product: 'handcash-mobile',
  mobileVersion: mobilePkg.version,
  uiCore: {
    package: '@handcash/wallet-ui',
    version: uiPkg.version,
    desktopPackageVersion: desktopPkg.version,
    gitSha: sha,
    gitShort: short,
    gitBranch: branch,
    dirty,
    path: path.relative(mobileRoot, path.join(desktopRoot, 'src')),
  },
  builtAt: new Date().toISOString(),
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(pin, null, 2)}\n`)
console.info(
  `[ui-core] pinned @handcash/wallet-ui@${uiPkg.version} (${short}${dirty ? ', dirty' : ''}) → ${path.relative(mobileRoot, outPath)}`,
)
