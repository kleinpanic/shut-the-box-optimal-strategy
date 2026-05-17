import { diceDistribution } from './dice.js';
import { enumerateLegalMoves, tileValue } from './moves.js';
import type { DPTables } from './types.js';

const TWO_DICE_DIST = diceDistribution(false);
const ONE_DICE_DIST = diceDistribution(true);

/**
 * Computes all three DP tables for 512 board states via bottom-up DP.
 *
 * State ordering: applying any move to state s yields s' < s (since move removes ≥1 open tile),
 * so iterating s = 0..511 guarantees all needed sub-states are computed first.
 *
 * Three separate value functions (one per objective) allow each to use its own optimal policy.
 * When useOneDie=true, states with tiles 7–9 closed (state & 0x1C0 === 0) use 1d6.
 */
export function computeDPTables(useOneDie: boolean): DPTables {
  const expectedScore = new Float64Array(512);
  const shutProbability = new Float64Array(512);
  const survivalProbability = new Float64Array(512);

  // Base case: state 0 means box is shut.
  shutProbability[0] = 1;
  survivalProbability[0] = 1;
  // expectedScore[0] = 0 (default)

  for (let s = 1; s <= 511; s++) {
    const dist = useOneDie && (s & 0x1c0) === 0 ? ONE_DICE_DIST : TWO_DICE_DIST;

    let sv = 0;
    let ev1 = 0;
    let ev2 = 0;

    for (const [roll, prob] of dist) {
      const moves = enumerateLegalMoves(s, roll);
      if (moves.length === 0) {
        // Stuck: game ends, score = sum of remaining open tiles.
        ev1 += prob * tileValue(s);
        // shutProbability contribution: 0 (box not shut)
      } else {
        sv += prob; // this roll has at least one legal move

        let best1 = Infinity;
        let best2 = -Infinity;
        for (const m of moves) {
          const ns = s & ~m.mask;
          if (expectedScore[ns] < best1) best1 = expectedScore[ns];
          if (shutProbability[ns] > best2) best2 = shutProbability[ns];
        }
        ev1 += prob * best1;
        ev2 += prob * best2;
      }
    }

    survivalProbability[s] = sv;
    expectedScore[s] = ev1;
    shutProbability[s] = ev2;
  }

  return { expectedScore, shutProbability, survivalProbability };
}

export const TWO_DICE_DP: DPTables = computeDPTables(false);
export const ONE_DICE_DP: DPTables = computeDPTables(true);
