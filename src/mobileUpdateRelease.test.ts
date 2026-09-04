import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { selectMobileRelease, semverGreaterThan } from './mobileUpdateRelease.ts'

describe('selectMobileRelease', () => {
  const releases = [
    {
      tag_name: 'v0.1.310',
      draft: false,
      published_at: '2026-09-01T00:00:00Z',
      html_url: 'https://example.test/releases/v0.1.310',
      assets: [
        {
          name: 'handcash-mobile-0.1.310.apk',
          browser_download_url: 'https://example.test/0.1.310.apk',
        },
      ],
    },
    {
      tag_name: 'v0.1.200',
      draft: false,
      published_at: '2026-08-01T00:00:00Z',
      html_url: 'https://example.test/releases/v0.1.200',
      assets: [
        {
          name: 'handcash-mobile-0.1.200.apk',
          browser_download_url: 'https://example.test/0.1.200.apk',
        },
      ],
    },
  ]

  it('selects the newest release with a matching APK', () => {
    assert.deepEqual(selectMobileRelease(releases, '0.1.300'), {
      version: '0.1.310',
      apkUrl: 'https://example.test/0.1.310.apk',
      releaseUrl: 'https://example.test/releases/v0.1.310',
    })
  })

  it('does not offer the current or an older release', () => {
    assert.equal(selectMobileRelease(releases, '0.1.310'), null)
    assert.equal(selectMobileRelease(releases, '0.2.0'), null)
  })

  it('fails closed when the matching APK asset is absent', () => {
    const noApk = [
      {
        tag_name: 'v0.1.400',
        draft: false,
        published_at: '2026-09-02T00:00:00Z',
        html_url: 'https://example.test/releases/v0.1.400',
        assets: [
          {
            name: 'notes.txt',
            browser_download_url: 'https://example.test/notes.txt',
          },
        ],
      },
      ...releases,
    ]
    assert.equal(selectMobileRelease(noApk, '0.1.300')?.version, '0.1.310')
    assert.equal(selectMobileRelease(noApk.slice(0, 1), '0.1.100'), null)
  })

  it('skips drafts and unpublished releases', () => {
    assert.equal(
      selectMobileRelease(
        [
          {
            tag_name: 'v0.1.400',
            draft: true,
            published_at: '2026-09-02T00:00:00Z',
            html_url: 'https://example.test/releases/v0.1.400',
            assets: [
              {
                name: 'handcash-mobile-0.1.400.apk',
                browser_download_url: 'https://example.test/0.1.400.apk',
              },
            ],
          },
          {
            tag_name: 'v0.1.401',
            draft: false,
            published_at: null,
            html_url: 'https://example.test/releases/v0.1.401',
            assets: [
              {
                name: 'handcash-mobile-0.1.401.apk',
                browser_download_url: 'https://example.test/0.1.401.apk',
              },
            ],
          },
        ],
        '0.1.100',
      ),
      null,
    )
  })
})

describe('semverGreaterThan', () => {
  it('compares numeric semver components', () => {
    assert.equal(semverGreaterThan('0.1.310', '0.1.99'), true)
    assert.equal(semverGreaterThan('v2.0.0', '1.99.99'), true)
    assert.equal(semverGreaterThan('0.1.310', '0.1.310'), false)
    assert.equal(semverGreaterThan('0.1.200', '0.1.310'), false)
  })
})
