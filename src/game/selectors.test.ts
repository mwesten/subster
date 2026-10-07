import { describe, expect, it } from 'vitest'
import { activePlayer, deckRanOut, leaderboard, winner } from './selectors'
import { initialState } from './reducer'
import type { GameState, Player, TimelineCard } from './types'
import type { Song } from '../subsonic/client'

function card(id: string, year: number): TimelineCard {
  const song: Song = { id, title: `T${id}`, artist: `A${id}`, year }
  return { song, year }
}

function player(id: string, cards = 0): Player {
  return {
    id,
    name: id.toUpperCase(),
    timeline: Array.from({ length: cards }, (_, i) => card(`${id}-${i}`, 1990 + i)),
    tokens: 0,
  }
}

function makeState(players: Player[], overrides: Partial<GameState> = {}): GameState {
  return { ...initialState(), players, ...overrides }
}

describe('activePlayer', () => {
  it('returns the player at the turn index', () => {
    const players = [player('p0'), player('p1'), player('p2')]
    const state = makeState(players, { turn: { ...initialState().turn, activePlayerIndex: 1 } })
    expect(activePlayer(state)).toBe(players[1])
  })
})

describe('winner', () => {
  it('finds the player matching winnerId', () => {
    const players = [player('p0'), player('p1')]
    expect(winner(makeState(players, { winnerId: 'p1' }))).toBe(players[1])
  })

  it('returns null when there is no winner', () => {
    const players = [player('p0'), player('p1')]
    expect(winner(makeState(players, { winnerId: null }))).toBeNull()
    expect(winner(makeState(players, { winnerId: 'nobody' }))).toBeNull()
  })
})

describe('leaderboard', () => {
  it('sorts players by timeline length descending without mutating the input', () => {
    const players = [player('p0', 1), player('p1', 3), player('p2', 2)]
    const state = makeState(players)
    expect(leaderboard(state).map((p) => p.id)).toEqual(['p1', 'p2', 'p0'])
    expect(state.players.map((p) => p.id)).toEqual(['p0', 'p1', 'p2']) // untouched
  })
})

describe('deckRanOut', () => {
  const settings = { winTarget: 10, startTokens: 0, challengeGrace: false }

  it('is true when the game ended below the target', () => {
    const state = makeState([player('p0', 3), player('p1', 1)], { phase: 'gameover', winnerId: 'p0', settings })
    expect(deckRanOut(state)).toBe(true)
  })

  it('is false for a real win', () => {
    const state = makeState([player('p0', 10)], { phase: 'gameover', winnerId: 'p0', settings })
    expect(deckRanOut(state)).toBe(false)
  })

  it('is false while the game is still running', () => {
    const state = makeState([player('p0', 3)], { phase: 'placing', winnerId: null, settings })
    expect(deckRanOut(state)).toBe(false)
  })
})
