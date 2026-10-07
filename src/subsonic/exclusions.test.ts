import { describe, expect, it } from 'vitest'
import { artistParts, buildMatcher, exclusionId, type Exclusion } from './exclusions'
import type { Song } from './client'

const song = (artist: string, title: string, album?: string): Song => ({ id: title, artist, title, album })

describe('artistParts', () => {
  it('splits collaborations but keeps the whole credit', () => {
    expect(artistParts('Queen & David Bowie')).toEqual(['queen david bowie', 'queen', 'david bowie'])
    expect(artistParts('Calvin Harris feat. Ellie Goulding')).toContain('ellie goulding')
  })

  it('leaves "and" inside band names alone', () => {
    expect(artistParts('Simon and Garfunkel')).toEqual(['simon and garfunkel'])
  })
})

describe('buildMatcher', () => {
  it('matches nothing when the list is empty', () => {
    expect(buildMatcher([])(song('Queen', 'Bohemian Rhapsody'))).toBe(false)
  })

  it('excludes an artist, including collaborations, but not a similar name', () => {
    const excluded = buildMatcher([{ kind: 'artist', name: 'Queen' }])
    expect(excluded(song('Queen', 'Bohemian Rhapsody'))).toBe(true)
    expect(excluded(song('Queen & David Bowie', 'Under Pressure'))).toBe(true)
    expect(excluded(song('Queen Latifah', 'U.N.I.T.Y.'))).toBe(false)
  })

  it('matches by name, tolerating the differences between servers', () => {
    const excluded = buildMatcher([{ kind: 'song', artist: 'The Beatles', title: 'Hey Jude' }])
    expect(excluded(song('Beatles', 'Hey Jude (Remastered 2015)'))).toBe(true)
    expect(excluded(song('The Beatles', 'Let It Be'))).toBe(false)
  })

  it("excludes a playlist's songs", () => {
    const playlist: Exclusion = {
      kind: 'playlist',
      name: 'No-go',
      songs: [{ artist: 'Toto', title: 'Africa' }],
      serverId: 's1',
      playlistId: 'p1',
    }
    expect(buildMatcher([playlist])(song('Toto', 'Africa'))).toBe(true)
  })

  it('excludes an album by its artist, or any track of a compilation', () => {
    const excluded = buildMatcher([
      { kind: 'album', name: 'Thriller', artist: 'Michael Jackson' },
      { kind: 'album', name: 'Bravo Hits 12', artist: 'Various Artists' },
    ])
    expect(excluded(song('Michael Jackson', 'Beat It', 'Thriller'))).toBe(true)
    expect(excluded(song('Someone Else', 'Thriller', 'Thriller'))).toBe(false)
    expect(excluded(song('Anybody', 'Any Song', 'Bravo Hits 12'))).toBe(true)
  })
})

describe('exclusionId', () => {
  it('is the same for names that only differ in spelling details', () => {
    expect(exclusionId({ kind: 'artist', name: 'The Beatles' })).toBe(
      exclusionId({ kind: 'artist', name: 'beatles' }),
    )
  })
})
