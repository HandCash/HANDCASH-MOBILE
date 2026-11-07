import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/release-apk.yml', import.meta.url), 'utf8')
const publishGuard = "if: (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')) || inputs.publish == true"

test('manual APK builds default to artifacts only, even when dispatched on a tag', () => {
  assert.match(workflow, /publish:\s+description:.*\s+required: false\s+type: boolean\s+default: false/)
  assert.equal(workflow.split(publishGuard).length - 1, 2)
  for (const name of ['Ensure GitHub Release exists', 'Upload APK and metadata']) {
    assert.ok(workflow.includes(`- name: ${name}\n        ${publishGuard}`))
  }
})

test('signed APKs retain their checksum and shared-core provenance without publication', () => {
  const artifactStep = workflow.split('- name: Keep signed APK and provenance as workflow artifacts')[1]!.split('- name: Ensure GitHub Release exists')[0]!
  assert.ok(artifactStep.includes('uses: actions/upload-artifact@v4'))
  assert.ok(!artifactStep.includes('if:'))
  for (const suffix of ['*.apk', '*.sha256', '*.ui-core-pin.json']) {
    assert.ok(artifactStep.includes(`HANDCASH-MOBILE/artifacts/${suffix}`))
  }
  assert.ok(artifactStep.includes('if-no-files-found: error'))
})
