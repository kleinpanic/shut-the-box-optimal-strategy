/**
 * Returns a probability distribution over dice sums.
 * oneDie=false: 2d6, sums 2–12.
 * oneDie=true:  1d6, sums 1–6.
 */
export function diceDistribution(oneDie: boolean): Map<number, number> {
  const dist = new Map<number, number>();
  if (oneDie) {
    for (let i = 1; i <= 6; i++) {
      dist.set(i, 1 / 6);
    }
  } else {
    for (let d1 = 1; d1 <= 6; d1++) {
      for (let d2 = 1; d2 <= 6; d2++) {
        const sum = d1 + d2;
        dist.set(sum, (dist.get(sum) ?? 0) + 1 / 36);
      }
    }
  }
  return dist;
}
