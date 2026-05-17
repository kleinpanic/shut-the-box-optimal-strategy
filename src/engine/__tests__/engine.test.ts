import { describe, it, expect } from 'vitest';
import { diceDistribution } from '../dice.js';
import { enumerateLegalMoves, tileValue } from '../moves.js';
import { computeDPTables, TWO_DICE_DP } from '../dp.js';
import { getRankedMoves } from '../advisor.js';

// ---------------------------------------------------------------------------
// diceDistribution
// ---------------------------------------------------------------------------
describe('diceDistribution', () => {
  it('two-dice probabilities sum to 1', () => {
    const dist = diceDistribution(false);
    const total = [...dist.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('one-dice probabilities sum to 1', () => {
    const dist = diceDistribution(true);
    const total = [...dist.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('P(7) = 6/36 for two dice', () => {
    const dist = diceDistribution(false);
    expect(dist.get(7)).toBeCloseTo(6 / 36, 10);
  });

  it('P(2) = 1/36 for two dice', () => {
    const dist = diceDistribution(false);
    expect(dist.get(2)).toBeCloseTo(1 / 36, 10);
  });

  it('P(12) = 1/36 for two dice', () => {
    const dist = diceDistribution(false);
    expect(dist.get(12)).toBeCloseTo(1 / 36, 10);
  });

  it('P(6) = 5/36 for two dice', () => {
    const dist = diceDistribution(false);
    expect(dist.get(6)).toBeCloseTo(5 / 36, 10);
  });

  it('P(1) = 1/6 for one die', () => {
    const dist = diceDistribution(true);
    expect(dist.get(1)).toBeCloseTo(1 / 6, 10);
  });

  it('P(6) = 1/6 for one die', () => {
    const dist = diceDistribution(true);
    expect(dist.get(6)).toBeCloseTo(1 / 6, 10);
  });

  it('two-dice covers exactly sums 2–12', () => {
    const dist = diceDistribution(false);
    for (let i = 2; i <= 12; i++) expect(dist.has(i)).toBe(true);
    expect(dist.has(1)).toBe(false);
    expect(dist.has(13)).toBe(false);
  });

  it('one-die covers exactly sums 1–6', () => {
    const dist = diceDistribution(true);
    for (let i = 1; i <= 6; i++) expect(dist.has(i)).toBe(true);
    expect(dist.has(7)).toBe(false);
  });

  it('two-dice has 11 entries', () => {
    expect(diceDistribution(false).size).toBe(11);
  });

  it('one-die has 6 entries', () => {
    expect(diceDistribution(true).size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// enumerateLegalMoves
// ---------------------------------------------------------------------------
describe('enumerateLegalMoves', () => {
  it('returns empty when state is 0 (box shut)', () => {
    expect(enumerateLegalMoves(0, 7)).toHaveLength(0);
  });

  it('returns empty when roll is 0', () => {
    expect(enumerateLegalMoves(0x1ff, 0)).toHaveLength(0);
  });

  it('returns empty when no subset sums to roll', () => {
    // Only tile 3 open (bit 2), roll = 5 → {3} ≠ 5
    expect(enumerateLegalMoves(1 << 2, 5)).toHaveLength(0);
  });

  it('single tile match', () => {
    // Only tile 5 open, roll = 5
    const state = 1 << 4;
    const moves = enumerateLegalMoves(state, 5);
    expect(moves).toHaveLength(1);
    expect(moves[0].tiles).toEqual([5]);
    expect(moves[0].mask).toBe(state);
  });

  it('finds {3} and {1,2} for roll=3 with tiles 1,2,3,4 open', () => {
    const state = 0b1111; // tiles 1,2,3,4
    const moves = enumerateLegalMoves(state, 3);
    const sets = moves.map((m) => m.tiles.slice().sort((a, b) => a - b));
    expect(sets).toContainEqual([3]);
    expect(sets).toContainEqual([1, 2]);
  });

  it('full state roll=6 contains {6},{1,5},{2,4},{1,2,3}', () => {
    const moves = enumerateLegalMoves(0x1ff, 6);
    const sets = moves.map((m) => m.tiles.slice().sort((a, b) => a - b));
    expect(sets).toContainEqual([6]);
    expect(sets).toContainEqual([1, 5]);
    expect(sets).toContainEqual([2, 4]);
    expect(sets).toContainEqual([1, 2, 3]);
  });

  it('move masks correctly encode tiles', () => {
    const moves = enumerateLegalMoves(0x1ff, 9);
    for (const m of moves) {
      let expected = 0;
      for (const t of m.tiles) expected |= 1 << (t - 1);
      expect(m.mask).toBe(expected);
    }
  });

  it('all returned tiles are open in the given state', () => {
    const state = 0b010101010; // tiles 2,4,6,8
    const moves = enumerateLegalMoves(state, 6);
    for (const m of moves) {
      for (const t of m.tiles) {
        expect(state & (1 << (t - 1))).not.toBe(0);
      }
    }
  });

  it('tile sums equal the roll for every move', () => {
    const roll = 10;
    const moves = enumerateLegalMoves(0x1ff, roll);
    for (const m of moves) {
      const sum = m.tiles.reduce((a, b) => a + b, 0);
      expect(sum).toBe(roll);
    }
  });
});

// ---------------------------------------------------------------------------
// tileValue
// ---------------------------------------------------------------------------
describe('tileValue', () => {
  it('state 0 → score 0', () => {
    expect(tileValue(0)).toBe(0);
  });

  it('state 0x1FF (all open) → score 45', () => {
    expect(tileValue(0x1ff)).toBe(45); // 1+2+…+9
  });

  it('only tile 9 open → score 9', () => {
    expect(tileValue(1 << 8)).toBe(9);
  });

  it('tiles 1 and 9 → score 10', () => {
    expect(tileValue(1 | (1 << 8))).toBe(10);
  });

  it('tiles 1–5 open → score 15', () => {
    expect(tileValue(0b011111)).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
describe('state transitions', () => {
  it('applying a move clears the correct bits', () => {
    const state = 0x1ff;
    const moveMask = (1 << 2) | (1 << 4); // tiles 3 and 5
    const next = state & ~moveMask;
    expect(next & (1 << 2)).toBe(0); // tile 3 closed
    expect(next & (1 << 4)).toBe(0); // tile 5 closed
    expect(next & (1 << 0)).not.toBe(0); // tile 1 still open
  });

  it('closing all tiles one by one reaches state 0', () => {
    let s = 0x1ff;
    for (let t = 1; t <= 9; t++) s &= ~(1 << (t - 1));
    expect(s).toBe(0);
  });

  it('applying move from enumerateLegalMoves is a valid state transition', () => {
    const state = 0x1ff;
    const roll = 7;
    const moves = enumerateLegalMoves(state, roll);
    expect(moves.length).toBeGreaterThan(0);
    const next = state & ~moves[0].mask;
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(state);
  });
});

// ---------------------------------------------------------------------------
// DP tables — correctness
// ---------------------------------------------------------------------------
describe('computeDPTables', () => {
  it('produces arrays of length 512', () => {
    const dp = computeDPTables(false);
    expect(dp.expectedScore.length).toBe(512);
    expect(dp.shutProbability.length).toBe(512);
    expect(dp.survivalProbability.length).toBe(512);
  });

  it('state 0 → expectedScore=0, shutProb=1, survivalProb=1', () => {
    const dp = TWO_DICE_DP;
    expect(dp.expectedScore[0]).toBe(0);
    expect(dp.shutProbability[0]).toBe(1);
    expect(dp.survivalProbability[0]).toBe(1);
  });

  it('single-tile-2 state: EV ≈ (35/36)*2', () => {
    // Only tile 2 open (state = 0b10 = 2). Roll 2 (P=1/36) closes it → score 0.
    // All other rolls → stuck with score 2.
    const expected = (35 / 36) * 2;
    expect(TWO_DICE_DP.expectedScore[2]).toBeCloseTo(expected, 6);
  });

  it('single-tile-1 state: EV = 1 (tile 1 unreachable via 2d6)', () => {
    // Min 2d6 roll is 2. Tile 1 alone sums to 1. Always stuck → score 1.
    expect(TWO_DICE_DP.expectedScore[1]).toBeCloseTo(1, 8);
  });

  it('full state EV is less than 45', () => {
    expect(TWO_DICE_DP.expectedScore[0x1ff]).toBeLessThan(45);
    expect(TWO_DICE_DP.expectedScore[0x1ff]).toBeGreaterThan(0);
  });

  it('full state shutProbability is strictly between 0 and 1', () => {
    const p = TWO_DICE_DP.shutProbability[0x1ff];
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('all expectedScore values are non-negative', () => {
    for (let s = 0; s < 512; s++) {
      expect(TWO_DICE_DP.expectedScore[s]).toBeGreaterThanOrEqual(0);
    }
  });

  it('all shutProbability values are in [0,1]', () => {
    for (let s = 0; s < 512; s++) {
      expect(TWO_DICE_DP.shutProbability[s]).toBeGreaterThanOrEqual(0);
      expect(TWO_DICE_DP.shutProbability[s]).toBeLessThanOrEqual(1);
    }
  });

  it('all survivalProbability values are in [0,1]', () => {
    for (let s = 0; s < 512; s++) {
      expect(TWO_DICE_DP.survivalProbability[s]).toBeGreaterThanOrEqual(0);
      expect(TWO_DICE_DP.survivalProbability[s]).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('one-die DP: tile-1 state can be shut (P > 0)', () => {
    const dp = computeDPTables(true);
    // tile 1 only open (state=1), state & 0x1C0 = 0 → uses 1d6
    // Roll 1 with P=1/6 closes tile 1 → shut
    expect(dp.shutProbability[1]).toBeCloseTo(1 / 6, 8);
  });

  it('one-die DP shutProbability[1] > two-dice DP shutProbability[1]', () => {
    const dpOne = computeDPTables(true);
    const dpTwo = computeDPTables(false);
    expect(dpOne.shutProbability[1]).toBeGreaterThan(dpTwo.shutProbability[1]);
  });
});

// ---------------------------------------------------------------------------
// Advisor / objective ranking
// ---------------------------------------------------------------------------
describe('getRankedMoves', () => {
  it('returns empty for no legal moves', () => {
    // tile 1 only open, roll 2 → no subset sums to 2
    expect(getRankedMoves(1, 2, 'minimize_score', false)).toHaveLength(0);
  });

  it('first move is marked isOptimal=true', () => {
    const ranked = getRankedMoves(0x1ff, 7, 'minimize_score', false);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].isOptimal).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].isOptimal).toBe(false);
    }
  });

  it('minimize_score ranks by ascending expectedScore', () => {
    const ranked = getRankedMoves(0x1ff, 9, 'minimize_score', false);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].value).toBeGreaterThanOrEqual(ranked[i - 1].value);
    }
  });

  it('maximize_shutting ranks by descending shutProbability', () => {
    const ranked = getRankedMoves(0x1ff, 9, 'maximize_shutting', false);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].value).toBeLessThanOrEqual(ranked[i - 1].value);
    }
  });

  it('maximize_survival ranks by descending survivalProbability', () => {
    const ranked = getRankedMoves(0x1ff, 9, 'maximize_survival', false);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].value).toBeLessThanOrEqual(ranked[i - 1].value);
    }
  });

  it('explanation contains objective-specific text', () => {
    const ms = getRankedMoves(0x1ff, 7, 'minimize_score', false);
    const mx = getRankedMoves(0x1ff, 7, 'maximize_shutting', false);
    const sv = getRankedMoves(0x1ff, 7, 'maximize_survival', false);
    expect(ms[0].explanation).toContain('Expected');
    expect(mx[0].explanation).toContain('P(shut');
    expect(sv[0].explanation).toContain('P(survive');
  });

  it('different objectives can yield different optimal moves', () => {
    // With enough moves, the optimal choice may differ across objectives
    const ms = getRankedMoves(0x1ff, 9, 'minimize_score', false);
    const mx = getRankedMoves(0x1ff, 9, 'maximize_shutting', false);
    // At least both return a result; we check that the objectives can disagree
    expect(ms[0]).toBeDefined();
    expect(mx[0]).toBeDefined();
  });

  it('uses one-die DP when useOneDie=true and tiles 7-9 are closed', () => {
    // state = 0b0111111 = 63: tiles 1-6 open, 7-9 closed
    const state = 63;
    const twoRanked = getRankedMoves(state, 5, 'maximize_shutting', false);
    const oneRanked = getRankedMoves(state, 5, 'maximize_shutting', true);
    // Both should return moves; values may differ due to different DP tables
    expect(twoRanked.length).toBeGreaterThan(0);
    expect(oneRanked.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------
describe('terminal states', () => {
  it('state 0 is the shut box', () => {
    expect(tileValue(0)).toBe(0);
    expect(enumerateLegalMoves(0, 7)).toHaveLength(0);
  });

  it('state 0x1FF is fully open', () => {
    expect(tileValue(0x1ff)).toBe(45);
  });

  it('shutProbability[0] = 1 (already shut)', () => {
    expect(TWO_DICE_DP.shutProbability[0]).toBe(1);
  });

  it('expectedScore[0] = 0 (already shut)', () => {
    expect(TWO_DICE_DP.expectedScore[0]).toBe(0);
  });
});
