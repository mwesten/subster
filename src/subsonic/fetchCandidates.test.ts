import { describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../store/configStore'
import type { Song } from './client'

const getRandomSongs = vi.fn<(c: ServerConfig, o: { musicFolderId?: string; size?: number }) => Promise<Song[]>>()
vi.mock('./client', () => ({ getRandomSongs: (c: ServerConfig, o: object) => getRandomSongs(c, o) }))

const { fetchCandidates } = await import('./deck')

const config: ServerConfig = { id: 's', name: 'x', baseUrl: 'https://x', username: 'u', salt: 'a', token: 'b' }
const songs = (prefix: string, n: number): Song[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix} ${i}`, artist: prefix }))

describe('fetchCandidates', () => {
  it('makes one unscoped pull when no library is chosen', async () => {
    getRandomSongs.mockReset().mockResolvedValue(songs('a', 3))
    await fetchCandidates(config, { size: 3 })
    expect(getRandomSongs.mock.calls.map(([, o]) => o.musicFolderId)).toEqual([undefined])
  })

  it('gives each chosen library an equal share of the pool', async () => {
    getRandomSongs
      .mockReset()
      .mockImplementation(async (_c, o) => songs(o.musicFolderId === '1' ? 'big' : 'small', o.size ?? 0))
    const pool = await fetchCandidates(config, { size: 6, musicFolderIds: ['1', '2'] })
    expect(pool.filter((s) => s.artist === 'big')).toHaveLength(3)
    expect(pool.filter((s) => s.artist === 'small')).toHaveLength(3)
  })

  it('lets the others fill in for a library that runs short', async () => {
    getRandomSongs
      .mockReset()
      .mockImplementation(async (_c, o) => (o.musicFolderId === '1' ? songs('big', o.size ?? 0) : songs('tiny', 1)))
    const pool = await fetchCandidates(config, { size: 6, musicFolderIds: ['1', '2'] })
    expect(pool).toHaveLength(6)
    expect(pool.filter((s) => s.artist === 'tiny')).toHaveLength(1)
  })
})
