import type { ServerConfig } from '../store/configStore'
import { getArtists, search3, type Song } from '../subsonic/client'
import { JsonCache } from '../lib/cache'
import { artistKey, curatedEntries, curatedKey } from './curated'
import { interleave, shuffle } from '../subsonic/deck'

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
  opts: { musicFolderIds?: string[]; want: number; maxSearches: number },
): Promise<Song[]> {
  // Subsonic scopes a search to one library at a time, so with several chosen
  // each is a scope of its own; `undefined` searches every library.
  const scopes = opts.musicFolderIds?.length ? opts.musicFolderIds : [undefined]
  // Which scopes hold each artist — a canon song is then searched for only
  // where its artist actually is, not once per library.
  const artistScopes = new Map<string, Array<string | undefined>>()
  const artistLists = await Promise.allSettled(scopes.map((f) => getArtists(config, f)))
  if (artistLists.every((r) => r.status === 'rejected')) return []
  artistLists.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    for (const name of r.value) {
      const k = artistKey(name)
      const list = artistScopes.get(k) ?? []
      if (!list.includes(scopes[i])) list.push(scopes[i])
      artistScopes.set(k, list)
    }
  })

  const cacheKey = (scope: string | undefined, key: string) =>
    `${config.baseUrl}|${scope ?? ''}|${key}`
  const candidates = shuffle(
    curatedEntries.filter((e) => artistScopes.has(artistKey(e.artist))),
    Math.random,
  )
    .map((e) => {
      const key = curatedKey(e.artist, e.title)
      const where = (artistScopes.get(artistKey(e.artist)) ?? [])
        .map((scope) => ({ scope, known: inLibraryCache.get(cacheKey(scope, key)) }))
        .filter((w) => w.known !== false)
        // A scope it is known to be in goes first.
        .sort((a, b) => Number(b.known === true) - Number(a.known === true))
      return { e, key, where, known: where.some((w) => w.known === true) }
    })
    .filter((c) => c.where.length > 0)
  // Alternate known hits with songs not searched yet. A known hit is a
  // near-sure find, so it keeps the budget productive; the unsearched ones
  // keep the canon rotating. Searching known hits first instead locked every
  // game onto the first game's finds: the search stops at `want`, so only
  // those ever became known, and the rest of the library's canon was never
  // looked at again.
  const ordered = interleave([
    candidates.filter((c) => c.known),
    candidates.filter((c) => !c.known),
  ])

  const lookup = async ({ e, key, where }: (typeof candidates)[number]): Promise<Song | null> => {
    for (const { scope } of where) {
      let hits: Song[]
      try {
        hits = await search3(config, {
          query: `${e.artist} ${e.title}`,
          songCount: 5,
          musicFolderId: scope,
        })
      } catch {
        return null // transient failure: don't cache a miss
      }
      const song = hits.find((s) => curatedKey(s.artist, s.title) === key) ?? null
      inLibraryCache.set(cacheKey(scope, key), song !== null)
      if (song) return song
    }
    return null
  }

  const found: Song[] = []
  const budget = ordered.slice(0, opts.maxSearches)
  for (let i = 0; i < budget.length && found.length < opts.want; i += CONCURRENCY) {
    const songs = await Promise.all(budget.slice(i, i + CONCURRENCY).map(lookup))
    for (const song of songs) if (song) found.push(song)
  }
  return found.slice(0, opts.want)
}
