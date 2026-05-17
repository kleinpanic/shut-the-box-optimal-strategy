/** Bitmask: bit i set means tile (i+1) is open. Full open = 0x1FF (511). Shut = 0. */
export type GameState = number;

export type Objective = 'minimize_score' | 'maximize_shutting' | 'maximize_survival';

export interface Move {
  /** Tile numbers to close (1–9) */
  tiles: number[];
  /** Bitmask of tiles included in this move */
  mask: number;
}

export interface RankedMove {
  move: Move;
  /** Objective-specific value (lower = better for minimize_score, higher = better otherwise) */
  value: number;
  isOptimal: boolean;
  explanation: string;
}

export interface DPTables {
  /** expectedScore[s]: optimal expected final tile-sum starting from state s */
  expectedScore: Float64Array;
  /** shutProbability[s]: optimal P(reaching state 0) from state s */
  shutProbability: Float64Array;
  /** survivalProbability[s]: P(next roll has ≥1 legal move) from state s */
  survivalProbability: Float64Array;
}
