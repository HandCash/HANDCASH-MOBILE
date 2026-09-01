/**
 * Beta mobile updates — poll GitHub releases and prompt sideload APK install.
 * Mirrors Desktop update.mode (default | manual | none) via the shared UI core.
 */

import { nativeOpenDappBrowser } from './dappBrowserNative'

export type UpdateMode = 'default' | 'manual' | 'none'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'ready'
  | 'error'

export type UpdateStatus = {
  phase: UpdatePhase
  mode: UpdateMode
  currentVersion: string
  availableVersion: string | null
  percent: number | null
  error: string | null
  canInstall: boolean
}

type GitHubRelease = {
  tag_name: string
  draft: boolean
  published_at: string | null
  html_url: string
  assets: Array<{ name: string; browser_download_url: string }>
}

type PendingRelease = {
  version: string
  apkUrl: string
  releaseUrl: string
}

const MODE_KEY = 'handcash.update.mode'
const GITHUB_RELEASES =
  'https://api.github.com/repos/HandCash/HANDCASH-MOBILE/releases?per_page=20'
const AUTO_CHECK_MS = 4 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 25_000
const APK_HINT =
  'APK download opened — install the file when it finishes, then reopen HandCash.'

const VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const listeners = new Set<(status: UpdateStatus) => void>()
let status: UpdateStatus = {
  phase: 'idle',
  mode: readMode(),
  currentVersion: VERSION,
  availableVersion: null,
  percent: null,
  error: null,
  canInstall: false,
}
let pendingRelease: PendingRelease | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null
let checkInFlight: Promise<UpdateStatus> | null = null
let started = false

function readMode(): UpdateMode {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    if (raw === 'default' || raw === 'manual' || raw === 'none') return raw
  } catch {
    // ignore
  }
  return 'default'
}

function writeMode(mode: UpdateMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // ignore
  }
}

function parseSemver(raw: string): number[] {
  const parts = raw
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => {
      const n = Number.parseInt(part.replace(/[^0-9].*$/, ''), 10)
      return Number.isFinite(n) ? n : 0
    })
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

export function semverGreaterThan(a: string, b: string): boolean {
  const av = parseSemver(a)
  const bv = parseSemver(b)
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return av[i] > bv[i]
  }
  return false
}

function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '')
}

function apkAsset(release: GitHubRelease) {
  return release.assets.find(
    (asset) =>
      asset.name.endsWith('.apk') &&
      /^handcash-mobile-[\d.]+\.apk$/i.test(asset.name),
  )
}

function selectMobileRelease(
  releases: GitHubRelease[],
  currentVersion: string,
): PendingRelease | null {
  for (const release of releases) {
    if (release.draft || !release.published_at) continue
    const asset = apkAsset(release)
    if (!asset) continue
    const version = normalizeVersion(release.tag_name)
    if (!version || !semverGreaterThan(version, currentVersion)) continue
    return {
      version,
      apkUrl: asset.browser_download_url,
      releaseUrl: release.html_url,
    }
  }
  return null
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer = 0
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    window.clearTimeout(timer)
  }
}

async function discoverRelease(): Promise<PendingRelease | null> {
  const response = await fetch(GITHUB_RELEASES, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `HandCash-Mobile/${status.currentVersion}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status})`)
  }
  const releases = (await response.json()) as GitHubRelease[]
  return selectMobileRelease(releases, status.currentVersion)
}

function pushStatus(): void {
  for (const listener of listeners) listener({ ...status })
  if (status.phase === 'available' && status.availableVersion) {
    document.dispatchEvent(
      new CustomEvent('handcash:update-available', {
        detail: {
          version: status.availableVersion,
          apkUrl: pendingRelease?.apkUrl ?? null,
          releaseUrl: pendingRelease?.releaseUrl ?? null,
        },
      }),
    )
  }
}

function setStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  pushStatus()
}

export function getMobileUpdateStatus(): UpdateStatus {
  return { ...status }
}

export function onMobileUpdateStatus(handler: (next: UpdateStatus) => void): () => void {
  listeners.add(handler)
  handler({ ...status })
  return () => {
    listeners.delete(handler)
  }
}

export async function setMobileUpdateMode(mode: UpdateMode): Promise<UpdateStatus> {
  writeMode(mode)
  setStatus({ mode })
  scheduleAutomaticChecks()
  return { ...status }
}

async function openApkDownload(release: PendingRelease): Promise<void> {
  const opened = await nativeOpenDappBrowser(release.apkUrl)
  if (!opened.ok) {
    throw new Error(opened.error || 'Could not open APK download')
  }
}

export async function checkMobileUpdates(opts?: {
  reason?: 'auto' | 'manual'
}): Promise<UpdateStatus> {
  const reason = opts?.reason ?? 'manual'
  const mode = readMode()
  status.mode = mode

  if (reason === 'auto' && mode !== 'default') return { ...status }
  if (mode === 'none' && reason === 'manual') {
    setStatus({
      phase: 'error',
      error: 'Updates are disabled (mode: none).',
      canInstall: false,
      availableVersion: null,
      percent: null,
    })
    return { ...status }
  }

  if (checkInFlight) return checkInFlight

  checkInFlight = (async () => {
    try {
      setStatus({
        phase: 'checking',
        error: null,
        currentVersion: VERSION,
      })
      pendingRelease = await withTimeout(
        discoverRelease(),
        CHECK_TIMEOUT_MS,
        'Update check',
      )
      if (!pendingRelease) {
        setStatus({
          phase: 'not-available',
          availableVersion: null,
          percent: null,
          canInstall: false,
          error: null,
        })
        return { ...status }
      }

      setStatus({
        phase: 'available',
        availableVersion: pendingRelease.version,
        percent: null,
        error: null,
        canInstall: true,
      })
      return { ...status }
    } catch (err) {
      setStatus({
        phase: 'error',
        availableVersion: null,
        percent: null,
        canInstall: false,
        error: err instanceof Error ? err.message : String(err),
      })
      return { ...status }
    } finally {
      checkInFlight = null
    }
  })()

  return checkInFlight
}

export async function downloadMobileUpdate(): Promise<UpdateStatus> {
  const release = pendingRelease
  if (!release) {
    setStatus({
      phase: 'error',
      error: 'No update version to download yet. Check for updates first.',
      canInstall: false,
      percent: null,
    })
    return { ...status }
  }
  try {
    setStatus({ phase: 'downloading', percent: null, error: null, canInstall: true })
    await openApkDownload(release)
    setStatus({
      phase: 'available',
      availableVersion: release.version,
      percent: null,
      error: APK_HINT,
      canInstall: true,
    })
  } catch (err) {
    setStatus({
      phase: 'error',
      availableVersion: release.version,
      percent: null,
      canInstall: true,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return { ...status }
}

export async function installMobileUpdate(): Promise<void> {
  await downloadMobileUpdate()
}

function scheduleAutomaticChecks(): void {
  if (checkTimer != null) {
    window.clearInterval(checkTimer)
    checkTimer = null
  }
  if (readMode() !== 'default') return
  checkTimer = window.setInterval(() => {
    void checkMobileUpdates({ reason: 'auto' })
  }, AUTO_CHECK_MS)
}

/** Start periodic checks and run one background poll when mode is default. */
export function startMobileUpdateChecks(): void {
  if (started) return
  started = true
  status.currentVersion = VERSION
  status.mode = readMode()
  pushStatus()
  scheduleAutomaticChecks()
  if (readMode() === 'default') {
    window.setTimeout(() => {
      void checkMobileUpdates({ reason: 'auto' })
    }, 4_000)
  }
}
