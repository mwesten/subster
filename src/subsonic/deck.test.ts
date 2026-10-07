import { describe, expect, it } from 'vitest'
import {
  buildDeckOrder,
  computeQuotas,
  deckFloor,
  DIFFICULTY,
  interleave,
  isLiveVersion,
  isNonOriginalVersion,
  artistLimit,
  spreadArtists,
  tierIndex,
  type ClassifiedSong,
} from './deck'
import type { Song } from './client'

/** Deterministic PRNG so the weighted draws are reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function make(id: string, year: number, known: boolean): ClassifiedSong {
  const song: Song = { id, title: id, artist: id, year }
  return { song, decade: Math.floor(year / 10) * 10, known }
}

describe('buildDeckOrder — decade spread', () => {
  it('front-loads a sparse decade above its raw proportion (√-weighting)', () => {
    const items: ClassifiedSong[] = []
    for (let i = 0; i < 100; i++) items.push(make(`crowd${i}`, 2010 + (i % 10), true))
    for (let i = 0; i < 4; i++) items.push(make(`rare${i}`, 1960 + i, true))

    const order = buildDeckOrder(items, 0.75, mulberry32(42))
    expect(order).toHaveLength(104)

    // Overall share of the sparse 1960s decade is 4/104 ≈ 3.8%. √-weighting
    // gives it a constant, higher per-draw chance until it depletes, so its
    // share in the first quarter of the deck must exceed the overall share.
    const firstQuarter = order.slice(0, 26)
    const rareEarly = firstQuarter.filter((s) => s.id.startsWith('rare')).length
    expect(rareEarly / firstQuarter.length).toBeGreaterThan(4 / 104)
  })
})

describe('buildDeckOrder — 75/25 known/rest mix', () => {
  it('deals roughly the requested ratio of known songs', () => {
    const items: ClassifiedSong[] = []
    for (let i = 0; i < 80; i++) items.push(make(`k${i}`, 1990 + (i % 20), true))
    for (let i = 0; i < 80; i++) items.push(make(`r${i}`, 1990 + (i % 20), false))

    const order = buildDeckOrder(items, 0.75, mulberry32(7))
    const first40 = order.slice(0, 40)
    const knownCount = first40.filter((s) => s.id.startsWith('k')).length
    // Target 30/40; allow sampling slack.
    expect(knownCount).toBeGreaterThanOrEqual(25)
    expect(knownCount).toBeLessThanOrEqual(35)
  })

  it('falls back to the rest pool when known music is too thin', () => {
    const items: ClassifiedSong[] = []
    for (let i = 0; i < 5; i++) items.push(make(`k${i}`, 2000 + i, true))
    for (let i = 0; i < 60; i++) items.push(make(`r${i}`, 1980 + (i % 30), false))

    const order = buildDeckOrder(items, 0.75, mulberry32(1))
    expect(order).toHaveLength(65) // every song dealt
    const ids = new Set(order.map((s) => s.id))
    for (let i = 0; i < 5; i++) expect(ids.has(`k${i}`)).toBe(true) // all known included
  })
})

describe('popularity tiers', () => {
  const tiers = DIFFICULTY.balanced // [550k, 380k, 250k]

  it('maps a rank to the right tier and rejects below the floor', () => {
    expect(tierIndex(900_000, tiers)).toBe(0)
    expect(tierIndex(400_000, tiers)).toBe(1)
    expect(tierIndex(300_000, tiers)).toBe(2)
    expect(tierIndex(150_000, tiers)).toBe(-1) // below floor
    expect(deckFloor(tiers)).toBe(250_000)
  })

  it('computes per-tier quotas from the deck target', () => {
    expect(computeQuotas(48, tiers)).toEqual([19, 17, 12]) // 40/35/25
  })
})

describe('isNonOriginalVersion', () => {
  it('flags karaoke, instrumental, demo, rehearsal and alternate takes', () => {
    // The first two were both seen in a real library.
    expect(isNonOriginalVersion('What I Got (Demo)')).toBe(true)
    expect(isNonOriginalVersion('’54, ’74, ’90, 2010 (karaoke version)')).toBe(true)
    expect(isNonOriginalVersion('Song - Instrumental')).toBe(true)
    expect(isNonOriginalVersion('Song (Rehearsal)')).toBe(true)
    expect(isNonOriginalVersion('Song (Alternate Take)')).toBe(true)
  })

  it('still flags everything the live filter catches', () => {
    expect(isNonOriginalVersion('Song (Live at Wembley)')).toBe(true)
    expect(isNonOriginalVersion('Niemals einer Meinung', 'Das 1000. Konzert')).toBe(true)
  })

  it('keeps the versions people actually know', () => {
    expect(isNonOriginalVersion('Song (Radio Edit)')).toBe(false)
    expect(isNonOriginalVersion('Song (Single Version)')).toBe(false)
    expect(isNonOriginalVersion('Song (Extended Mix)')).toBe(false)
    expect(isNonOriginalVersion('All Along the Watchtower')).toBe(false)
  })

  it('only matches a suffix marker, never a bare word in the title', () => {
    expect(isNonOriginalVersion('Demons')).toBe(false)
    expect(isNonOriginalVersion('Karaoke Plays')).toBe(false) // a real Maximo Park song
    expect(isNonOriginalVersion('Karaoke', 'Songs from the Wood')).toBe(false)
    expect(isNonOriginalVersion('Instrumental Break')).toBe(false)
    expect(isNonOriginalVersion('Demolition Man')).toBe(false)
  })

  it('does not treat any dash in a title as a version marker', () => {
    // A dash is weak evidence: the remainder has to be the marker itself.
    expect(isNonOriginalVersion('Alright - Karaoke Kings')).toBe(false)
    expect(isNonOriginalVersion('Alright - Demo Days')).toBe(false)
    // …but a genuine annotation still counts, with or without a qualifier.
    expect(isNonOriginalVersion('Alright - Karaoke Version')).toBe(true)
    expect(isNonOriginalVersion('Alright - Demo')).toBe(true)
  })

  it('ignores the album for these terms, unlike the live check', () => {
    // "The Flying Demos" is a name, not a statement about the recordings.
    expect(isNonOriginalVersion('Some Song', 'The Flying Demos')).toBe(false)
    expect(isNonOriginalVersion('Some Song', 'Karaoke Classics')).toBe(false)
  })
})

describe('isLiveVersion', () => {
  it('flags live/unplugged by title', () => {
    expect(isLiveVersion('Song (Live)')).toBe(true)
    expect(isLiveVersion('Song - Live')).toBe(true)
    expect(isLiveVersion('Song (Live at Wembley)')).toBe(true)
    expect(isLiveVersion('Song (MTV Unplugged)')).toBe(true)
  })

  it('flags live by album even when the title looks studio', () => {
    // The real-world miss: track title has no "live", album is a live record.
    expect(isLiveVersion('Niemals einer Meinung', 'Das 1000. Konzert')).toBe(true)
    expect(isLiveVersion('Some Song', 'MTV Unplugged in New York')).toBe(true)
  })

  it('does not flag studio tracks that merely contain the word live', () => {
    expect(isLiveVersion('Live and Let Die', 'Band on the Run')).toBe(false)
    expect(isLiveVersion('Alive', 'Ten')).toBe(false)
  })
})

describe('spreadArtists', () => {
  const s = (id: string, artist: string): Song => ({ id, title: id, artist, year: 2000 })
  const artists = (list: Song[]) => list.map((x) => x.artist)
  const hasAdjacentDup = (list: Song[]) => list.some((x, i) => i > 0 && x.artist === list[i - 1]?.artist)

  it('separates adjacent same-artist songs when possible', () => {
    const out = spreadArtists([s('1', 'A'), s('2', 'A'), s('3', 'B'), s('4', 'C')])
    expect(hasAdjacentDup(out)).toBe(false)
    expect(out).toHaveLength(4)
  })

  it('guards the seam against the previous batch', () => {
    const out = spreadArtists([s('1', 'A'), s('2', 'B')], ['A'])
    expect(out[0]?.artist).toBe('B') // first must differ from prevArtist 'A'
  })

  it('keeps an artist `gap` cards apart, so with two players it alternates between them', () => {
    // A third of the deck by one artist: adjacent-only spreading made this
    // A x A x A x, every A to the same player.
    const songs = ['A', 'A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map((a, i) => s(String(i), a))
    const out = spreadArtists(songs, [], 2)
    const at = out.flatMap((x, i) => (x.artist === 'A' ? [i] : []))
    expect(at).toEqual([0, 3, 6])
    expect(new Set(at.map((i) => i % 2))).toEqual(new Set([0, 1]))
  })

  it('falls back to just avoiding the previous artist when the window cannot be cleared', () => {
    const out = spreadArtists([s('1', 'A'), s('2', 'A'), s('3', 'B')], [], 2)
    expect(artists(out)).toEqual(['A', 'B', 'A'])
  })

  it('tells artists apart by the main one of several credited', () => {
    const joined: Song = { ...s('1', 'A • B'), artists: ['A', 'B'] }
    const out = spreadArtists([s('0', 'A'), joined, s('2', 'C')])
    expect(out.map((x) => x.id)).toEqual(['0', '2', '1'])
  })

  it('leaves an unavoidable run intact (more of one artist than gaps)', () => {
    const out = spreadArtists([s('1', 'A'), s('2', 'A'), s('3', 'A')])
    expect(artists(out)).toEqual(['A', 'A', 'A'])
  })
})

describe('interleave', () => {
  it('takes one from each list in turn, and lets a long list run on', () => {
    expect(interleave([['a1', 'a2', 'a3', 'a4'], ['b1'], ['c1', 'c2']])).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3', 'a4'])
  })
})

describe('artistLimit', () => {
  const s = (id: string, artist: string, artists?: string[]): Song => ({ id, title: id, artist, artists })

  it('admits up to the cap per artist, counting a joined credit as its main artist', () => {
    const limit = artistLimit(2)
    expect(limit.admit(s('1', 'A'))).toBe(true)
    expect(limit.admit(s('2', 'a'))).toBe(true) // case doesn't make a new artist
    expect(limit.admit(s('3', 'A • B', ['A', 'B']))).toBe(false)
    expect(limit.admit(s('4', 'B'))).toBe(true)
  })

  it('lets a held-back card through when forced, and counts it', () => {
    const limit = artistLimit(1)
    limit.admit(s('1', 'A'))
    expect(limit.admit(s('2', 'A'), true)).toBe(true)
    expect(limit.admit(s('3', 'A'))).toBe(false)
  })
})
