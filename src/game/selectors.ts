import type { GameState, Player } from './types'

export function activePlayer(state: GameState): Player {
  // The reducer keeps activePlayerIndex in [0, players.length).
  return state.players[state.turn.activePlayerIndex] as Player
}

export function winner(state: GameState): Player | null {
  return state.players.find((p) => p.id === state.winnerId) ?? null
}

export function leaderboard(state: GameState): Player[] {
  return [...state.players].sort((a, b) => b.timeline.length - a.timeline.length)
}

/**
 * The game ended because the deck was used up, not because someone reached
 * the target: the chosen songs (library, filters, popularity) ran short.
 */
export function deckRanOut(state: GameState): boolean {
  const champ = winner(state)
  return state.phase === 'gameover' && !!champ && champ.timeline.length < state.settings.winTarget
}
