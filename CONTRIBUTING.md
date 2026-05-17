# Contributing

## Getting started

```bash
git clone https://github.com/kleinpanic/shut-the-box-optimal-strategy.git
cd shut-the-box-optimal-strategy
npm install
npm run dev
```

## Development workflow

| Command                 | Purpose                 |
| ----------------------- | ----------------------- |
| `npm run dev`           | Start dev server        |
| `npm run lint`          | Run ESLint              |
| `npm run format`        | Format with Prettier    |
| `npm run typecheck`     | TypeScript type check   |
| `npm test`              | Run tests               |
| `npm run test:coverage` | Run tests with coverage |
| `npm run build`         | Production build        |

## Before submitting a PR

All CI checks must pass locally:

```bash
npm run lint && npm run format:check && npm run typecheck && npm run test:coverage && npm run build
```

## Engine changes

The statistical engine lives in `src/engine/`. Any changes to DP logic, move enumeration, or dice distribution must be accompanied by tests in `src/engine/__tests__/engine.test.ts`.

## Code style

- TypeScript strict mode is enabled
- Prettier handles formatting
- ESLint enforces code quality
- No unused variables or imports
