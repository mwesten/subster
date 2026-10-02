import type { ServerConfig } from '../store/configStore'
import { getArtists, search3, type Song } from '../subsonic/client'
import { JsonCache } from '../lib/cache'
import { artistKey, curatedEntries, curatedKey } from './curated'
import { shuffle } from '../subsonic/deck'

/**
 * Locate famous-canon songs that actually exist in the library.
 *
 * Canon songs are a tiny slice of any library (~2–3%), so they never surface
 * often enough in a random deck pull — we must fetch them on purpose. To keep
 * that cheap: pull the library's artist list once and only search for canon
 * songs whose artist is present (most searches would otherwise miss). Whether
 * each canon song is in the library is cached persistently, so the misses —
 * the vast majority — cost no search after the first time.
 *
 * Only that yes/no is cached, never the song itself: server ids (song, cover
 * art) change when a file is moved or retagged or the server migrates its
 * database, and a cached id then points at nothing — the song "fails to play".
 * A known hit is searched again each game to get its current id.
 */
const inLibraryCache = new JsonCache<boolean>('curated-in-lib-v1')
// Held whole songs, stale ids included — superseded by the yes/no cache above.
JsonCache.dropNamespace('curated-lib-v1')

/** Searches in flight at once — known hits are many, and each is a round trip. */
const CONCURRENCY = 4

export async function findCuratedSongs(
  config: ServerConfig,
  opts: { musicFolderId?: string; want: number; maxSearches: number },
): Promise<Song[]> {
  const folderId = opts.musicFolderId ?? ''
  let libArtists: Set<string>
  try {
    libArtists = new Set((await getArtists(config, opts.musicFolderId)).map(artistKey))
  } catch {
    return []
  }

  const cacheKey = (key: string) => `${config.baseUrl}|${folderId}|${key}`
  const candidates = shuffle(
    curatedEntries.filter((e) => libArtists.has(artistKey(e.artist))),
    Math.random,
  )
    .map((e) => {
      const key = curatedKey(e.artist, e.title)
      return { e, key, known: inLibraryCache.get(cacheKey(key)) }
    })
    .filter((c) => c.known !== false)
  // Known hits first: their search is a near-sure find, so the budget goes to
  // them before songs that may well be missing. (Stable sort keeps the shuffle.)
  candidates.sort((a, b) => Number(b.known === true) - Number(a.known === true))

  const lookup = async ({ e, key }: (typeof candidates)[number]): Promise<Song | null> => {
    let hits: Song[]
    try {
      hits = await search3(config, {
        query: `${e.artist} ${e.title}`,
        songCount: 5,
        musicFolderId: opts.musicFolderId,
      })
    } catch {
      return null // transient failure: don't cache a miss
    }
    const song = hits.find((s) => curatedKey(s.artist, s.title) === key) ?? null
    inLibraryCache.set(cacheKey(key), song !== null)
    return song
  }

  const found: Song[] = []
  const budget = candidates.slice(0, opts.maxSearches)
  for (let i = 0; i < budget.length && found.length < opts.want; i += CONCURRENCY) {
    const songs = await Promise.all(budget.slice(i, i + CONCURRENCY).map(lookup))
    for (const song of songs) if (song) found.push(song)
  }
  return found.slice(0, opts.want)
}
