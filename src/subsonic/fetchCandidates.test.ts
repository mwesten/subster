import { describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../store/configStore'
import type { Song } from './client'

const getRandomSongs = vi.fn<(c: ServerConfig, o: { musicFolderId?: string; size?: number }) => Promise<Song[]>>()
const librarySongCount = vi.fn<(folder: string) => Promise<number>>()
vi.mock('./client', () => ({
  getRandomSongs: (c: ServerConfig, o: object) => getRandomSongs(c, o),
  librarySongCount: (_c: ServerConfig, folder: string) => librarySongCount(folder),
}))

const { fetchCandidates, shareBySize } = await import('./deck')

const config: ServerConfig = { id: 's', name: 'x', baseUrl: 'https://x', username: 'u', salt: 'a', token: 'b' }
const songs = (prefix: string, n: number): Song[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix} ${i}`, artist: prefix }))

describe('fetchCandidates', () => {
  it('makes one unscoped pull when no library is chosen', async () => {
    getRandomSongs.mockReset().mockResolvedValue(songs('a', 3))
    await fetchCandidates(config, { size: 3 })
    expect(getRandomSongs.mock.calls.map(([, o]) => o.musicFolderId)).toEqual([undefined])
  })

  it('weights each chosen library by the square root of its size', async () => {
    librarySongCount.mockReset().mockImplementation(async (f) => (f === '1' ? 10_000 : 3_600))
    getRandomSongs
      .mockReset()
      .mockImplementation(async (_c, o) => songs(o.musicFolderId === '1' ? 'big' : 'small', o.size ?? 0))
    const pool = await fetchCandidates(config, { size: 100, musicFolderIds: ['1', '2'] })
    // √10000 : √3600 = 100 : 60
    expect(pool.filter((s) => s.artist === 'big')).toHaveLength(63)
    expect(pool.filter((s) => s.artist === 'small')).toHaveLength(37)
  })

  it('falls back to equal shares when a library cannot be counted', async () => {
    librarySongCount.mockReset().mockImplementation(async (f) => {
      if (f === '2') throw new Error('unsupported')
      return 10_000
    })
    getRandomSongs
      .mockReset()
      .mockImplementation(async (_c, o) => songs(o.musicFolderId === '1' ? 'big' : 'small', o.size ?? 0))
    const pool = await fetchCandidates(config, { size: 6, musicFolderIds: ['1', '2'] })
    expect(pool.filter((s) => s.artist === 'big')).toHaveLength(3)
    expect(pool.filter((s) => s.artist === 'small')).toHaveLength(3)
  })

  it('lets the others fill in for a library that runs short', async () => {
    librarySongCount.mockReset().mockResolvedValue(1000)
    getRandomSongs
      .mockReset()
      .mockImplementation(async (_c, o) => (o.musicFolderId === '1' ? songs('big', o.size ?? 0) : songs('tiny', 1)))
    const pool = await fetchCandidates(config, { size: 6, musicFolderIds: ['1', '2'] })
    expect(pool).toHaveLength(6)
    expect(pool.filter((s) => s.artist === 'tiny')).toHaveLength(1)
  })
})

describe('shareBySize', () => {
  const list = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
  const count = (out: string[], prefix: string) => out.filter((x) => x.startsWith(prefix)).length

  it('gives a small library less than an equal share, but at least half of one (reported setups)', () => {
    // Muziek 10,165 songs, Kindermuziek 429, Soundtrack 70; a pool of 160.
    const out = shareBySize([list('m', 160), list('k', 160), list('s', 70)], [10_165, 429, 70], 160)
    expect(out).toHaveLength(160)
    expect(count(out, 's')).toBe(26) // half of an equal third, not a third
    expect(count(out, 'k')).toBe(26)
    expect(count(out, 'm')).toBe(108)

    // 23,936 songs next to 97: √ alone gave the small one 6%; the floor gives 25%.
    const two = shareBySize([list('m', 160), list('k', 97)], [23_936, 97], 160)
    expect(count(two, 'k')).toBe(40)
  })

  it('passes a short list’s unused share on, and never exceeds what is there', () => {
    const out = shareBySize([list('a', 100), list('b', 2)], [100, 100], 50)
    expect(count(out, 'b')).toBe(2)
    expect(out).toHaveLength(50)
    expect(shareBySize([list('a', 3), list('b', 2)], [1, 1], 50)).toHaveLength(5)
  })
})
