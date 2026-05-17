import type { GameState, Objective, RankedMove } from './types.js';
import { enumerateLegalMoves } from './moves.js';
import { TWO_DICE_DP, ONE_DICE_DP } from './dp.js';

/**
 * Returns legal moves for (state, roll) ranked by the chosen objective.
 * The first element (isOptimal=true) is always the recommended move.
 */
export function getRankedMoves(
  state: GameState,
  roll: number,
  objective: Objective,
  useOneDie: boolean,
): RankedMove[] {
  const activeOneDie = useOneDie && (state & 0x1c0) === 0;
  const dp = activeOneDie ? ONE_DICE_DP : TWO_DICE_DP;
  const moves = enumerateLegalMoves(state, roll);
  if (moves.length === 0) return [];

  const ranked = moves.map((move) => {
    const ns = state & ~move.mask;
    let value: number;
    let explanation: string;

    if (objective === 'minimize_score') {
      value = dp.expectedScore[ns];
      explanation = `Expected final score: ${value.toFixed(2)} pts`;
    } else if (objective === 'maximize_shutting') {
      value = dp.shutProbability[ns];
      explanation = `P(shut box): ${(value * 100).toFixed(2)}%`;
    } else {
      value = dp.survivalProbability[ns];
      explanation = `P(survive next roll): ${(value * 100).toFixed(2)}%`;
    }

    return { move, value, explanation, isOptimal: false };
  });

  if (objective === 'minimize_score') {
    ranked.sort((a, b) => a.value - b.value);
  } else {
    ranked.sort((a, b) => b.value - a.value);
  }

  ranked[0].isOptimal = true;
  return ranked;
}
