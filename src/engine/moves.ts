import type { GameState, Move } from './types.js';

/**
 * Returns all non-empty subsets of open tiles (bitmask state) that sum to roll.
 * Uses standard bitmask subset enumeration: O(2^popcount(state)) per call.
 */
export function enumerateLegalMoves(state: GameState, roll: number): Move[] {
  const moves: Move[] = [];
  if (state === 0) return moves;

  let sub = state;
  while (sub > 0) {
    let sum = 0;
    const tiles: number[] = [];
    for (let i = 0; i < 9; i++) {
      if (sub & (1 << i)) {
        sum += i + 1;
        tiles.push(i + 1);
      }
    }
    if (sum === roll) {
      moves.push({ tiles, mask: sub });
    }
    sub = (sub - 1) & state;
  }
  return moves;
}

/** Sum of tile values for all open tiles in state. */
export function tileValue(state: GameState): number {
  let score = 0;
  for (let i = 0; i < 9; i++) {
    if (state & (1 << i)) score += i + 1;
  }
  return score;
}
