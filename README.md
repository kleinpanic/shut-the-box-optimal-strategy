# Shut the Box — Optimal Strategy

[![CI](https://github.com/kleinpanic/shut-the-box-optimal-strategy/actions/workflows/ci.yml/badge.svg)](https://github.com/kleinpanic/shut-the-box-optimal-strategy/actions/workflows/ci.yml)
[![Deploy](https://github.com/kleinpanic/shut-the-box-optimal-strategy/actions/workflows/deploy.yml/badge.svg)](https://github.com/kleinpanic/shut-the-box-optimal-strategy/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Live demo:** https://kleinpanic.github.io/shut-the-box-optimal-strategy/

A statistically optimal Shut the Box play assistant powered by a full dynamic programming engine over all 512 board states. Enter your dice roll and get ranked moves with expected values for three distinct objectives.

---

## What is Shut the Box?

Shut the Box is a dice game. You have 9 numbered tiles (1–9), all starting open. Each turn you roll two dice, then close any combination of open tiles that sums to the dice total. When you can't move, your score is the sum of remaining open tiles. Goal: score 0 (shut the box).

**One-die rule:** once only tiles 1–6 remain open, you may optionally roll a single die instead of two.

---

## Strategy Engine

The engine lives in `src/engine/` and implements:

| Component    | Description                                                                                |
| ------------ | ------------------------------------------------------------------------------------------ |
| `dice.ts`    | `diceDistribution(oneDie)` — exact probability maps for 2d6 (sums 2–12) and 1d6 (sums 1–6) |
| `moves.ts`   | `enumerateLegalMoves(state, roll)` — bitmask subset enumeration of all closing options     |
| `dp.ts`      | `computeDPTables(useOneDie)` — bottom-up DP over 512 states for 3 objectives               |
| `advisor.ts` | `getRankedMoves(state, roll, objective, useOneDie)` — ranked moves with EV explanations    |

### Three objectives

1. **Minimize Expected Score** — DP minimizes expected sum of remaining open tiles at game end
2. **Maximize Shut Probability** — DP maximizes P(reaching state 0)
3. **Maximize Survivability** — greedy: maximize P(next roll has ≥1 legal move)

### DP formulation

Board state is a 9-bit bitmask: bit `i` set = tile `i+1` is open. Full open = `0x1FF` (511), shut = `0`.

```
V₁(0) = 0,  V₂(0) = 1
For s > 0:
  V₁(s) = Σᵣ p(r) × { score(s)         if moves(s,r) = ∅
                      { min_m V₁(s & ~m)  otherwise
  V₂(s) = Σᵣ p(r) × { 0                 if moves(s,r) = ∅
                      { max_m V₂(s & ~m)  otherwise
```

Since any legal move `m` satisfies `m ⊆ s` and `m ≠ 0`, we have `s & ~m < s`, guaranteeing the bottom-up computation order `s = 0 … 511` is correct.

---

## Features

- **Live game assistant** — click tiles to toggle open/closed, enter your roll, see ranked moves
- **Optimal move highlight** — optimal tile(s) glow in the board and are labeled OPTIMAL
- **Rules panel** — objective selector, one-die mode toggle
- **Dice probability chart** — 2d6 or 1d6 distribution with current roll highlighted
- **Risk analysis** — live survival and shut probability progress bars
- **State analysis** — expected score, P(shut), P(survive) for the current board
- **Responsive dark theme** — works on mobile, tablet, and desktop

---

## Local development

```bash
git clone https://github.com/kleinpanic/shut-the-box-optimal-strategy.git
cd shut-the-box-optimal-strategy
npm install
npm run dev        # http://localhost:5173/shut-the-box-optimal-strategy/
```

## Running tests

```bash
npm test                # run all tests
npm run test:coverage   # with coverage report
```

Tests live in `src/engine/__tests__/engine.test.ts` and cover:

- `diceDistribution`: probability sums, spot-checks P(7)=6/36, range validation
- `enumerateLegalMoves`: empty states, single-tile, multi-subset cases, mask encoding
- `tileValue`: edge cases 0 and 0x1FF
- State transitions: bitmask correctness
- DP tables: base cases, single-tile EVs, monotonicity
- `getRankedMoves`: ranking order per objective, explanation text, optimal flag

## Build

```bash
npm run build       # output: dist/
npm run preview     # preview the production build
```

## Deployment

Deployed automatically to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`.

Manual enable (first time):

```bash
gh api repos/kleinpanic/shut-the-box-optimal-strategy/pages \
  --method POST --field build_type=workflow
```

---

## Tech stack

- **Vite 8** — build tool
- **TypeScript 6** — strict mode
- **Tailwind CSS 4** — utility CSS via Vite plugin
- **Vitest 4** — unit tests with v8 coverage
- **ESLint 10 + Prettier** — code quality

## License

MIT — see [LICENSE](LICENSE).
