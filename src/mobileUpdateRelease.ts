/**
 * Pure mobile APK release selection — mirrors Desktop macUpdateRelease.ts.
 */

export type GitHubRelease = {
  tag_name: string
  draft: boolean
  published_at: string | null
  html_url: string
  assets: Array<{ name: string; browser_download_url: string }>
}

export type PendingRelease = {
  version: string
  apkUrl: string
  releaseUrl: string
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
    if (av[i] !== bv[i]) return av[i]! > bv[i]!
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

export function selectMobileRelease(
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
