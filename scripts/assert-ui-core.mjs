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
const desktopCandidates = [
  path.resolve(mobileRoot, '../HANDCASH-DESKTOP'),
  path.resolve(mobileRoot, '../handcash-desktop'),
  path.resolve(mobileRoot, '../handcash-brc100'),
]
const desktopRoot = desktopCandidates.find((p) => fs.existsSync(p))
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

if (!desktopRoot) {
  die(`Desktop sibling missing — expected one of:\n${desktopCandidates.join('\n')}`)
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

/**
 * The Aeon engine is part of the UI core, so it has to come from the same tree
 * Desktop builds against. Mobile also carries its own `aeon-ui-engine` pin;
 * when the aliases resolved to that instead, a Positioner prop added in
 * Desktop's `vendor/` silently disappeared on the phone — the engine had never
 * heard of it, so it landed in the DOM spread and the panel anchored to the
 * wrong element. A drifted engine must fail the build, not ship.
 */
function assertAeonEngineFromDesktop() {
  const entry = path.join(
    desktopRoot,
    'vendor/aeon-ui-engine/packages/react/src/index.ts',
  )
  if (!fs.existsSync(entry)) {
    throw new Error(
      `[ui-core] Desktop does not vendor the Aeon engine at ${entry}`,
    )
  }
  const config = fs.readFileSync(
    path.join(mobileRoot, 'vite.config.ts'),
    'utf8',
  )
  if (!config.includes('desktopAeonAliases()')) {
    throw new Error(
      '[ui-core] vite.config.ts must resolve @aeon-ui/* from Desktop vendor ' +
        '(desktopAeonAliases); Mobile\'s own aeon-ui-engine pin drifts.',
    )
  }
  console.info(
    `[ui-core] Aeon engine → ${path.relative(mobileRoot, path.dirname(entry))}`,
  )
}

assertAeonEngineFromDesktop()

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
