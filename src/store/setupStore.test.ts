import { describe, expect, it } from 'vitest'
import { migrateSetup } from './setupStore'

const v2 = (musicFolderId: string) => ({
  prefs: {
    names: ['A'],
    byServer: { s1: { genre: '', musicFolderId, playlistId: '', metadataMode: 'full' } },
  },
})

describe('migrateSetup', () => {
  it('turns the single library of v2 into a list', () => {
    expect(migrateSetup(v2('7'), 2).prefs.byServer.s1?.musicFolderIds).toEqual(['7'])
  })

  it("keeps 'all' and 'never chosen' apart", () => {
    expect(migrateSetup(v2('all'), 2).prefs.byServer.s1?.musicFolderIds).toEqual([])
    expect(migrateSetup(v2(''), 2).prefs.byServer.s1?.musicFolderIds).toBeNull()
  })

  it('carries a v1 top-level source all the way through', () => {
    const v1 = { prefs: { names: ['A'], serverId: 's1', musicFolderId: '3', genre: 'Rock' } }
    const s1 = migrateSetup(v1, 1).prefs.byServer.s1
    expect(s1).toEqual({ genre: 'Rock', musicFolderIds: ['3'], playlistId: '', metadataMode: 'full' })
  })
})
