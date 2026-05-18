import './style.css';
import { getRankedMoves, tileValue, diceDistribution } from './engine/index.js';
import { TWO_DICE_DP, ONE_DICE_DP } from './engine/dp.js';
import type { DPTables, Objective, RankedMove } from './engine/types.js';

interface AppState {
  gameState: number;
  roll: number | null;
  objective: Objective;
  useOneDie: boolean;
}

const FULL_STATE = 0x1ff;

const state: AppState = {
  gameState: FULL_STATE,
  roll: null,
  objective: 'minimize_score',
  useOneDie: true,
};

const objectiveMeta: Record<Objective, { label: string; shortLabel: string; description: string }> =
  {
    minimize_score: {
      label: 'Minimize final score',
      shortLabel: 'Lowest score',
      description: 'Lowest expected remaining tile total.',
    },
    maximize_shutting: {
      label: 'Maximize shut chance',
      shortLabel: 'Shut chance',
      description: 'Highest probability of closing every tile.',
    },
    maximize_survival: {
      label: 'Maximize next-roll safety',
      shortLabel: 'Survival',
      description: 'Highest chance that the next roll stays playable.',
    },
  };

function canUseOneDie(gameState: number): boolean {
  return (gameState & 0x1c0) === 0;
}

function activeOneDie(): boolean {
  return state.useOneDie && canUseOneDie(state.gameState);
}

function activeDp(): DPTables {
  return state.useOneDie ? ONE_DICE_DP : TWO_DICE_DP;
}

function diceRange(): { min: number; max: number; values: number[] } {
  const min = activeOneDie() ? 1 : 2;
  const max = activeOneDie() ? 6 : 12;
  return {
    min,
    max,
    values: Array.from({ length: max - min + 1 }, (_, index) => min + index),
  };
}

function normalizeRoll(): void {
  if (state.roll === null) return;
  const range = diceRange();
  if (state.roll < range.min || state.roll > range.max) state.roll = null;
}

function openTiles(gameState = state.gameState): number[] {
  return Array.from({ length: 9 }, (_, index) => index + 1).filter(
    (tile) => (gameState & (1 << (tile - 1))) !== 0,
  );
}

function formatPercent(value: number, digits = 1): string {
  return (value * 100).toFixed(digits) + '%';
}

function scoreTone(score: number): string {
  if (score === 0) return 'score-zero';
  if (score <= 10) return 'score-low';
  if (score <= 24) return 'score-mid';
  return 'score-high';
}

function moveLabel(move: RankedMove): string {
  return move.move.tiles.join(' + ');
}

function rankedMoves(): RankedMove[] {
  if (state.roll === null || state.gameState === 0) return [];
  return getRankedMoves(state.gameState, state.roll, state.objective, state.useOneDie);
}

function randomRoll(): number {
  if (activeOneDie()) return Math.ceil(Math.random() * 6);
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

function render(): void {
  normalizeRoll();
  document.getElementById('app')!.innerHTML = buildApp();
  attach();
}

function buildApp(): string {
  const ranked = rankedMoves();
  return [
    '<div class="app-shell">',
    topBar(),
    '<main class="app-layout">',
    workflowPanel(ranked),
    '<section class="strategy-stage" aria-label="Optimal move workspace">',
    '<div class="board-stack">',
    gameSummary(ranked),
    tileBoard(ranked),
    dicePanel(),
    '</div>',
    '<div class="action-stack">',
    advisorPanel(ranked),
    '</div>',
    '</section>',
    '<section class="analysis-strip" aria-label="Strategy controls and analysis">',
    controlsPanel(),
    metricsPanel(),
    probabilityPanel(),
    rulesPanel(),
    '</section>',
    '</main>',
    '</div>',
  ].join('');
}

function topBar(): string {
  const score = tileValue(state.gameState);
  const rulesMode = state.useOneDie ? 'One-die rule on' : 'Two dice only';
  return [
    '<header class="top-bar">',
    '<div class="brand-mark" aria-hidden="true"><span>STB</span></div>',
    '<div class="brand-copy"><h1>Shut the Box</h1><p>Optimal strategy app</p></div>',
    '<div class="top-actions">',
    '<div class="score-pill ' +
      scoreTone(score) +
      '"><span>Open score</span><strong>' +
      score +
      '</strong></div>',
    '<div class="mode-pill">' + rulesMode + '</div>',
    '<button id="reset-btn" class="button button-quiet" type="button">New game</button>',
    '</div>',
    '</header>',
  ].join('');
}

function workflowPanel(ranked: RankedMove[]): string {
  const steps = [
    {
      label: 'Set board',
      value: openTiles().length + ' open',
      state: state.gameState === 0 ? 'done' : 'active',
    },
    {
      label: 'Choose roll',
      value: state.roll === null ? diceRange().min + '-' + diceRange().max : String(state.roll),
      state: state.roll === null ? 'active' : 'done',
    },
    {
      label: 'Best move',
      value:
        state.gameState === 0
          ? 'shut'
          : state.roll === null
            ? 'waiting'
            : ranked[0]
              ? moveLabel(ranked[0])
              : 'none',
      state: ranked[0] ? 'active' : state.gameState === 0 ? 'done' : 'idle',
    },
    {
      label: 'Apply',
      value: ranked[0] ? 'ready' : state.gameState === 0 ? 'done' : 'pending',
      state: ranked[0] ? 'active' : 'idle',
    },
  ];

  return (
    '<section class="workflow-panel" aria-label="Play workflow">' +
    steps
      .map(
        (step, index) =>
          '<div class="workflow-step is-' +
          step.state +
          '"><span>' +
          (index + 1) +
          '</span><div><strong>' +
          step.label +
          '</strong><small>' +
          step.value +
          '</small></div></div>',
      )
      .join('') +
    '</section>'
  );
}

function gameSummary(ranked: RankedMove[]): string {
  const score = tileValue(state.gameState);
  const open = openTiles();
  const best = ranked[0];
  const status =
    state.gameState === 0
      ? 'Box shut'
      : state.roll === null
        ? 'Choose a dice total'
        : best
          ? 'Close ' + moveLabel(best)
          : 'No legal move';
  const openLabel = open.length === 0 ? 'No tiles remain open.' : 'Open tiles: ' + open.join(', ');

  return [
    '<section class="summary-panel" aria-label="Current game state">',
    '<div><span class="eyebrow">Current position</span><h2>' +
      status +
      '</h2><p>' +
      openLabel +
      '</p></div>',
    '<div class="summary-stats">',
    '<div><span>Score</span><strong class="' + scoreTone(score) + '">' + score + '</strong></div>',
    '<div><span>Roll</span><strong>' + (state.roll ?? '-') + '</strong></div>',
    '<div><span>Moves</span><strong>' +
      (state.roll === null ? '-' : ranked.length) +
      '</strong></div>',
    '</div>',
    '</section>',
  ].join('');
}

function tileBoard(ranked: RankedMove[]): string {
  const optimalMask = ranked[0]?.move.mask ?? 0;
  const tiles = Array.from({ length: 9 }, (_, index) => {
    const tile = index + 1;
    const bit = 1 << index;
    const isOpen = (state.gameState & bit) !== 0;
    const isOptimal = (optimalMask & bit) !== 0;
    const classes = ['tile-button', isOpen ? 'is-open' : 'is-closed', isOptimal ? 'is-optimal' : '']
      .filter(Boolean)
      .join(' ');
    const label = isOpen ? 'Tile ' + tile + ' open' : 'Tile ' + tile + ' closed';
    return (
      '<button class="' +
      classes +
      '" type="button" data-tile="' +
      tile +
      '" aria-label="' +
      label +
      '"><span>' +
      tile +
      '</span></button>'
    );
  }).join('');

  return [
    '<section class="board-panel" aria-label="Tile board">',
    '<div class="section-heading"><div><span class="eyebrow">Board</span><h2>Open tiles</h2></div>',
    boardBadge(ranked),
    '</div>',
    '<div class="tile-row">' + tiles + '</div>',
    '</section>',
  ].join('');
}

function boardBadge(ranked: RankedMove[]): string {
  if (state.gameState === 0) return '<span class="status-badge success">Shut</span>';
  if (state.roll !== null && ranked.length === 0)
    return '<span class="status-badge danger">No move</span>';
  if (ranked[0]) return '<span class="status-badge good">Best move marked</span>';
  return '<span class="status-badge neutral">Ready</span>';
}

function dicePanel(): string {
  const range = diceRange();
  const modeLabel = activeOneDie() ? '1d6' : '2d6';
  const chips = range.values
    .map((value) => {
      const active = state.roll === value ? ' is-active' : '';
      return (
        '<button class="roll-chip' +
        active +
        '" type="button" data-roll="' +
        value +
        '" aria-label="Set dice total ' +
        value +
        '">' +
        value +
        '</button>'
      );
    })
    .join('');

  return [
    '<section class="panel dice-panel" aria-label="Dice controls">',
    '<div class="section-heading tight"><div><span class="eyebrow">Dice</span><h2>' +
      modeLabel +
      ' total</h2></div>',
    '<div class="panel-actions"><button id="random-roll-btn" class="button button-primary" type="button">Roll</button>' +
      (state.roll !== null
        ? '<button id="clear-roll-btn" class="button button-quiet" type="button">Clear</button>'
        : '') +
      '</div></div>',
    '<label class="number-field"><span>Total</span><input id="dice-input" type="number" min="' +
      range.min +
      '" max="' +
      range.max +
      '" inputmode="numeric" value="' +
      (state.roll ?? '') +
      '" placeholder="' +
      range.min +
      '-' +
      range.max +
      '" /></label>',
    '<div class="roll-grid">' + chips + '</div>',
    '<div class="dice-footer">' + diceVisual() + '</div>',
    '</section>',
  ].join('');
}

function diceVisual(): string {
  if (state.roll === null) return '<div class="dice-blank">Awaiting total</div>';
  if (activeOneDie()) return '<div class="dice-visual">' + dieFace(state.roll) + '</div>';
  const dice = splitRoll(state.roll);
  return (
    '<div class="dice-visual">' +
    dieFace(dice[0]) +
    '<span class="dice-plus">+</span>' +
    dieFace(dice[1]) +
    '</div>'
  );
}

function splitRoll(total: number): [number, number] {
  const first = Math.max(1, Math.min(6, Math.floor(total / 2)));
  return [first, total - first];
}

function dieFace(value: number): string {
  const active = new Set(
    {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8],
    }[value] ?? [],
  );
  const pips = Array.from({ length: 9 }, (_, index) =>
    active.has(index) ? '<span class="pip"></span>' : '<span></span>',
  ).join('');
  return '<div class="die" aria-label="Die showing ' + value + '">' + pips + '</div>';
}

function advisorPanel(ranked: RankedMove[]): string {
  if (state.gameState === 0) {
    return [
      '<section class="panel advisor-panel win-state" aria-label="Move advisor">',
      '<span class="eyebrow">Move advisor</span><h2>Box shut</h2><p>Final score: 0.</p>',
      '</section>',
    ].join('');
  }

  if (state.roll === null) {
    return [
      '<section class="panel advisor-panel" aria-label="Move advisor">',
      '<span class="eyebrow">Move advisor</span><h2>Pick a dice total</h2>',
      '<p class="muted">Objective: ' +
        objectiveMeta[state.objective].shortLabel +
        '. Legal moves rank as soon as a total is selected.</p>',
      '</section>',
    ].join('');
  }

  if (ranked.length === 0) {
    const score = tileValue(state.gameState);
    return [
      '<section class="panel advisor-panel danger-state" aria-label="Move advisor">',
      '<span class="eyebrow">Move advisor</span><h2>No legal move</h2><p>Final score: ' +
        score +
        '.</p>',
      '</section>',
    ].join('');
  }

  const best = ranked[0];
  const alternatives = ranked.slice(1, 5).map(moveRow).join('');
  return [
    '<section class="panel advisor-panel" aria-label="Move advisor">',
    '<div class="section-heading tight"><div><span class="eyebrow">Move advisor</span><h2>Close ' +
      moveLabel(best) +
      '</h2></div>',
    '<button class="button button-primary" type="button" data-move-mask="' +
      best.move.mask +
      '">Apply best</button></div>',
    '<div class="best-move-card"><div><span class="rank-label">Optimal</span><strong>' +
      best.explanation +
      '</strong><p>' +
      moveExplanation(best) +
      '</p></div></div>',
    alternatives
      ? '<div class="move-table" aria-label="Alternative moves"><div class="table-caption">Compare alternatives</div>' +
        alternatives +
        '</div>'
      : '<p class="muted compact">Only one legal move for this roll.</p>',
    '</section>',
  ].join('');
}

function moveExplanation(rankedMove: RankedMove): string {
  const nextState = state.gameState & ~rankedMove.move.mask;
  const dp = activeDp();
  const remaining = openTiles(nextState);
  const remainingLabel = remaining.length > 0 ? remaining.join(', ') : 'none';
  return (
    'Leaves ' +
    remainingLabel +
    '; EV ' +
    dp.expectedScore[nextState].toFixed(2) +
    ', shut ' +
    formatPercent(dp.shutProbability[nextState]) +
    ', survive ' +
    formatPercent(dp.survivalProbability[nextState]) +
    '.'
  );
}

function moveRow(rankedMove: RankedMove, index: number): string {
  return [
    '<button class="move-row" type="button" data-move-mask="' + rankedMove.move.mask + '">',
    '<span class="move-rank">' + (index + 2) + '</span>',
    '<span>Close ' + moveLabel(rankedMove) + '</span>',
    '<strong>' + rankedMove.explanation + '</strong>',
    '<em>Apply</em>',
    '</button>',
  ].join('');
}

function controlsPanel(): string {
  const objectives = (
    Object.entries(objectiveMeta) as Array<[Objective, (typeof objectiveMeta)[Objective]]>
  )
    .map(([objective, meta]) => {
      const active = state.objective === objective ? ' is-active' : '';
      return (
        '<button class="objective-option' +
        active +
        '" type="button" data-objective="' +
        objective +
        '"><span>' +
        meta.label +
        '</span><small>' +
        meta.description +
        '</small></button>'
      );
    })
    .join('');
  const eligible = canUseOneDie(state.gameState);
  const ruleStatus = state.useOneDie ? (eligible ? 'Active now' : 'Armed for later') : 'Off';

  return [
    '<section class="panel controls-panel" aria-label="Strategy controls">',
    '<div class="section-heading tight"><div><span class="eyebrow">Strategy</span><h2>Objective</h2></div></div>',
    '<div class="objective-list">' + objectives + '</div>',
    '<label class="switch-row"><span><strong>One-die rule</strong><small>' +
      ruleStatus +
      '</small></span><input id="one-die-toggle" type="checkbox" ' +
      (state.useOneDie ? 'checked' : '') +
      ' /></label>',
    '</section>',
  ].join('');
}

function metricsPanel(): string {
  const dp = activeDp();
  const score = tileValue(state.gameState);
  const rows = [
    ['Expected final score', dp.expectedScore[state.gameState].toFixed(2)],
    ['Chance to shut', formatPercent(dp.shutProbability[state.gameState])],
    ['Next-roll survival', formatPercent(dp.survivalProbability[state.gameState])],
  ];
  return [
    '<section class="panel metrics-panel" aria-label="State analysis">',
    '<span class="eyebrow">State analysis</span>',
    '<div class="metric-hero ' +
      scoreTone(score) +
      '"><span>Open score</span><strong>' +
      score +
      '</strong></div>',
    '<div class="metric-list">',
    rows
      .map(
        ([label, value]) => '<div><span>' + label + '</span><strong>' + value + '</strong></div>',
      )
      .join(''),
    '</div>',
    '</section>',
  ].join('');
}

function probabilityPanel(): string {
  const oneDie = activeOneDie();
  const dist = diceDistribution(oneDie);
  const max = Math.max(...dist.values());
  const bars = [...dist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([roll, probability]) => {
      const active = state.roll === roll ? ' is-active' : '';
      const height = (probability / max) * 100;
      return (
        '<div class="probability-bar' +
        active +
        '" style="--bar-height:' +
        height +
        '%"><span>' +
        formatPercent(probability, 0) +
        '</span><i></i><strong>' +
        roll +
        '</strong></div>'
      );
    })
    .join('');
  return [
    '<section class="panel probability-panel" aria-label="Dice probability distribution">',
    '<div class="section-heading tight"><div><span class="eyebrow">Dice odds</span><h2>' +
      (oneDie ? 'One die' : 'Two dice') +
      '</h2></div></div>',
    '<div class="probability-chart">' + bars + '</div>',
    '</section>',
  ].join('');
}

function rulesPanel(): string {
  return [
    '<section class="panel rules-panel" aria-label="Rules variant">',
    '<span class="eyebrow">Rules variant</span>',
    '<div class="rule-line"><span>High tiles</span><strong>' +
      (canUseOneDie(state.gameState) ? '1-6 only' : '7-9 open') +
      '</strong></div>',
    '<div class="rule-line"><span>Current dice</span><strong>' +
      (activeOneDie() ? '1d6' : '2d6') +
      '</strong></div>',
    '<div class="rule-line"><span>Policy table</span><strong>' +
      (state.useOneDie ? 'one-die eligible' : 'two dice') +
      '</strong></div>',
    '</section>',
  ].join('');
}

function attach(): void {
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    state.gameState = FULL_STATE;
    state.roll = null;
    state.objective = 'minimize_score';
    state.useOneDie = true;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-objective]').forEach((button) => {
    button.addEventListener('click', () => {
      state.objective = button.dataset.objective as Objective;
      render();
    });
  });

  document.getElementById('one-die-toggle')?.addEventListener('change', (event) => {
    state.useOneDie = (event.currentTarget as HTMLInputElement).checked;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-roll]').forEach((button) => {
    button.addEventListener('click', () => {
      state.roll = Number(button.dataset.roll);
      render();
    });
  });

  document.getElementById('random-roll-btn')?.addEventListener('click', () => {
    state.roll = randomRoll();
    render();
  });

  document.getElementById('clear-roll-btn')?.addEventListener('click', () => {
    state.roll = null;
    render();
  });

  document.getElementById('dice-input')?.addEventListener('input', (event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    state.roll = value === '' ? null : Number(value);
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-tile]').forEach((button) => {
    button.addEventListener('click', () => {
      const tile = Number(button.dataset.tile);
      state.gameState ^= 1 << (tile - 1);
      state.roll = null;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-move-mask]').forEach((button) => {
    button.addEventListener('click', () => {
      const mask = Number(button.dataset.moveMask);
      state.gameState &= ~mask;
      state.roll = null;
      render();
    });
  });
}

render();
