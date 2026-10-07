import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '../store/configStore'
import type { Song } from '../subsonic/client'

const getArtists = vi.fn<(folder?: string) => Promise<string[]>>()
const search3 = vi.fn<
  (c: ServerConfig, o: { query: string; musicFolderId?: string }) => Promise<Song[]>
>()
vi.mock('../subsonic/client', () => ({
  getArtists: (_c: ServerConfig, folder?: string) => getArtists(folder),
  search3: (c: ServerConfig, o: { query: string }) => search3(c, o),
}))

const { findCuratedSongs } = await import('./curatedFetch')

// The yes/no cache is module-level and persists across tests — each test uses
// its own baseUrl, which is part of the cache key.
function server(baseUrl: string): ServerConfig {
  return { id: baseUrl, name: 'x', baseUrl, username: 'u', salt: 'ab', token: 'cd' }
}

const opts = { want: 10, maxSearches: 50 }

beforeEach(() => {
  getArtists.mockReset().mockResolvedValue(['10cc'])
  search3.mockReset()
})

describe('findCuratedSongs', () => {
  it('resolves a known canon song afresh each game, so a changed id is never reused', async () => {
    const config = server('https://ids.example')
    search3.mockImplementation(async (_c, o) =>
      o.query.includes("I'm Not in Love")
        ? [{ id: 'old-id', title: "I'm Not in Love", artist: '10cc' }]
        : [],
    )
    expect((await findCuratedSongs(config, opts)).map((s) => s.id)).toEqual(['old-id'])

    // The server rescanned and the song got a new id.
    search3.mockImplementation(async (_c, o) =>
      o.query.includes("I'm Not in Love")
        ? [{ id: 'new-id', title: "I'm Not in Love", artist: '10cc' }]
        : [],
    )
    expect((await findCuratedSongs(config, opts)).map((s) => s.id)).toEqual(['new-id'])
  })

  it('caches misses, so a song known to be absent is not searched again', async () => {
    const config = server('https://miss.example')
    search3.mockResolvedValue([])
    expect(await findCuratedSongs(config, opts)).toEqual([])
    const firstRun = search3.mock.calls.length
    expect(firstRun).toBeGreaterThan(0)

    await findCuratedSongs(config, opts)
    expect(search3.mock.calls.length).toBe(firstRun) // every 10cc canon song is a cached miss
  })

  it('does not cache a miss when the search itself fails', async () => {
    const config = server('https://flaky.example')
    search3.mockRejectedValue(new Error('offline'))
    expect(await findCuratedSongs(config, opts)).toEqual([])

    search3.mockReset().mockImplementation(async (_c, o) =>
      o.query.includes("I'm Not in Love")
        ? [{ id: 'id', title: "I'm Not in Love", artist: '10cc' }]
        : [],
    )
    expect((await findCuratedSongs(config, opts)).map((s) => s.id)).toEqual(['id'])
  })

  it('searches only the chosen libraries that hold the artist', async () => {
    const config = server('https://scoped.example')
    getArtists.mockImplementation(async (folder) => (folder === 'b' ? ['10cc'] : ['Somebody Else']))
    search3.mockImplementation(async (_c, o) =>
      o.query.includes("I'm Not in Love")
        ? [{ id: 'id', title: "I'm Not in Love", artist: '10cc' }]
        : [],
    )
    const found = await findCuratedSongs(config, { ...opts, musicFolderIds: ['a', 'b'] })
    expect(found.map((s) => s.id)).toEqual(['id'])
    expect(new Set(search3.mock.calls.map(([, o]) => o.musicFolderId))).toEqual(new Set(['b']))
  })

  it('still searches the libraries it could list when another fails', async () => {
    const config = server('https://partial.example')
    getArtists.mockImplementation(async (folder) => {
      if (folder === 'a') throw new Error('offline')
      return ['10cc']
    })
    search3.mockResolvedValue([])
    await findCuratedSongs(config, { ...opts, musicFolderIds: ['a', 'b'] })
    expect(search3).toHaveBeenCalled()
  })
})
