import { curatedKey, normalizeName } from '../metadata/curated'
import type { Song } from './client'

/**
 * Something the player never wants dealt — e.g. songs or artists that upset
 * someone at the table.
 *
 * Everything is matched by name, never by server id: the list lives on the
 * device and has to keep working on every server, including ones that list
 * the same music under different ids. A playlist is kept as a snapshot of its
 * songs for the same reason (refreshed while its own server is active).
 */
export type Exclusion =
  | { kind: 'artist'; name: string }
  | { kind: 'album'; name: string; artist: string }
  | { kind: 'song'; title: string; artist: string }
  | {
      kind: 'playlist'
      name: string
      songs: Array<{ artist: string; title: string }>
      /** Where the snapshot came from, to refresh it while that server is active. */
      serverId: string
      playlistId: string
    }

/** Stable identity, so the same thing can't be added twice and can be found again. */
export function exclusionId(e: Exclusion): string {
  switch (e.kind) {
    case 'artist':
      return `artist:${normalizeName(e.name)}`
    case 'album':
      return `album:${normalizeName(e.artist)}┃${normalizeName(e.name)}`
    case 'song':
      return `song:${curatedKey(e.artist, e.title)}`
    case 'playlist':
      return `playlist:${e.serverId}:${e.playlistId}`
  }
}

// What a server puts between collaborating artists. " and " is deliberately
// missing: it is part of too many band names ("Simon and Garfunkel").
const ARTIST_SEPARATORS = /\s*(?:[,&/;+]|\bfeat\.?|\bft\.|\bfeaturing\b|\bvs\.?|\bx\b|\bwith\b)\s*/i

/**
 * Every artist a song credits, normalized: the whole credit plus each
 * collaborator, so excluding "Queen" also catches "Queen & David Bowie" —
 * but not "Queen Latifah".
 */
export function artistParts(artist: string): string[] {
  const parts = [artist, ...artist.split(ARTIST_SEPARATORS)].map(normalizeName).filter(Boolean)
  return [...new Set(parts)]
}

const VARIOUS = new Set(['various artists', 'various', 'va', 'verschiedene interpreten'].map(normalizeName))

/** Build a fast predicate from the current list. */
export function buildMatcher(exclusions: Exclusion[]): (song: Song) => boolean {
  const artists = new Set<string>()
  const songs = new Set<string>()
  const albums: Array<{ name: string; artist: string }> = []
  for (const e of exclusions) {
    if (e.kind === 'artist') artists.add(normalizeName(e.name))
    else if (e.kind === 'song') songs.add(curatedKey(e.artist, e.title))
    else if (e.kind === 'playlist') for (const s of e.songs) songs.add(curatedKey(s.artist, s.title))
    else albums.push({ name: normalizeName(e.name), artist: normalizeName(e.artist) })
  }
  if (!artists.size && !songs.size && !albums.length) return () => false

  return (song) => {
    if (songs.has(curatedKey(song.artist, song.title))) return true
    const parts = artistParts(song.artist)
    if (parts.some((p) => artists.has(p))) return true
    if (albums.length && song.album) {
      const album = normalizeName(song.album)
      // A compilation's tracks each name their own artist, not the album's.
      return albums.some((a) => a.name === album && (VARIOUS.has(a.artist) || parts.includes(a.artist)))
    }
    return false
  }
}
