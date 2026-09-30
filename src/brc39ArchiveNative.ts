import { registerPlugin } from '@capacitor/core'
import type { LocalBrc39ArchiveMeta } from '@desktop/wallet/brc39LocalArchive'
const Archive = registerPlugin<{
  append(args: { identityKey: string; bytesBase64: string; exportedAt?: number }): Promise<{ created: boolean; meta: LocalBrc39ArchiveMeta }>
  list(args: { identityKey: string }): Promise<{ snapshots: LocalBrc39ArchiveMeta[] }>
  read(args: { identityKey: string; id: string }): Promise<{ bytesBase64: string }>
}>('Brc39Archive')
export const nativeArchiveBrc39 = {
  archiveBrc39Snapshot: Archive.append,
  listBrc39Archive: async (identityKey: string) => (await Archive.list({ identityKey })).snapshots,
  readBrc39Archive: Archive.read,
}
