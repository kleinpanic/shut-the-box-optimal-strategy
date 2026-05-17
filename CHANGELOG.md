# Changelog

## [1.0.0] — 2026-05-16

### Added

- Full DP engine: 512-state bitmask board, three optimization objectives
- `enumerate_legal_moves`: bitmask subset enumeration
- `dice_distribution`: configurable 2d6 / 1d6 distributions
- `computeDPTables`: bottom-up DP for expected score, shut probability, survival probability
- `getRankedMoves`: objective-aware move ranking with explanations
- Live game assistant UI: tile grid, dice input, move advisor
- Dice probability distribution chart
- Risk analysis panel (survival + shut probability progress bars)
- State analysis panel with all three DP metrics
- One-die mode toggle (unlocked when tiles 7–9 are closed)
- Responsive dark-theme design
- GitHub Actions CI (lint, format, typecheck, test, build)
- GitHub Pages deployment via Actions
- Vitest unit tests with coverage (src/engine/)
