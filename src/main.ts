import './style.css';
import { getRankedMoves, tileValue, diceDistribution } from './engine/index.js';
import { TWO_DICE_DP, ONE_DICE_DP } from './engine/dp.js';
import type { DPTables, Objective, RankedMove } from './engine/types.js';

interface AppState {
  gameState: number;
  roll: number | null;
  objective: Objective;
  useOneDie: boolean;
  page: AppPage;
}

const FULL_STATE = 0x1ff;
type AppPage = 'play' | 'guide' | 'math';
const PAGE_PATHS: Record<AppPage, string> = {
  play: '/',
  guide: '/how-to-use',
  math: '/math',
};
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const DEPLOYED_BASE_PATH = '/shut-the-box-optimal-strategy';

const state: AppState = {
  gameState: FULL_STATE,
  roll: null,
  objective: 'minimize_score',
  useOneDie: true,
  page: currentPage(),
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

function currentPage(): AppPage {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const base = path.startsWith(DEPLOYED_BASE_PATH) ? DEPLOYED_BASE_PATH : BASE_PATH;
  const route = base && path.startsWith(base) ? path.slice(base.length) || '/' : path;
  const normalized = route.replace(/\/$/, '') || '/';
  if (normalized === PAGE_PATHS.math) return 'math';
  if (normalized === PAGE_PATHS.guide) return 'guide';
  return 'play';
}

function pageUrl(page: AppPage): string {
  const path = PAGE_PATHS[page];
  const base = window.location.pathname.startsWith(DEPLOYED_BASE_PATH)
    ? DEPLOYED_BASE_PATH
    : BASE_PATH;
  return base + (path === '/' ? '/' : path);
}

function setPage(page: AppPage, push = true): void {
  state.page = page;
  if (push) window.history.pushState({ page }, '', pageUrl(page));
  render();
}

function render(): void {
  normalizeRoll();
  document.getElementById('app')!.innerHTML = buildApp();
  attach();
}

function buildApp(): string {
  const ranked = rankedMoves();
  return ['<div class="app-shell">', topBar(), pageBody(ranked), '</div>'].join('');
}

function pageBody(ranked: RankedMove[]): string {
  if (state.page === 'guide') return guidePage();
  if (state.page === 'math') return mathPage();
  return playPage(ranked);
}

function playPage(ranked: RankedMove[]): string {
  return [
    '<main class="app-layout">',
    playPrimer(),
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
  ].join('');
}

function topBar(): string {
  const score = tileValue(state.gameState);
  const rulesMode = state.useOneDie ? 'One-die rule on' : 'Two dice only';
  return [
    '<header class="top-bar">',
    '<div class="brand-mark" aria-hidden="true"><span>STB</span></div>',
    '<div class="brand-copy"><h1>Shut the Box</h1><p>Optimal strategy app</p></div>',
    pageNav(),
    '<div class="top-actions">',
    '<div class="score-pill ' +
      scoreTone(score) +
      '"><span>Open score</span><strong>' +
      score +
      '</strong></div>',
    '<div class="mode-pill">' + rulesMode + '</div>',
    '<button id="reset-btn" class="button button-quiet" type="button" title="Reset the board to all tiles open and clear the roll.">New game</button>',
    '</div>',
    '</header>',
  ].join('');
}

function pageNav(): string {
  const pages: Array<[AppPage, string]> = [
    ['play', 'Play'],
    ['guide', 'How to use'],
    ['math', 'Math'],
  ];
  return (
    '<nav class="page-nav" aria-label="Primary pages">' +
    pages
      .map(([page, label]) => {
        const active = state.page === page ? ' is-active' : '';
        return (
          '<a class="nav-tab' +
          active +
          '" href="' +
          pageUrl(page) +
          '" data-page="' +
          page +
          '" aria-current="' +
          (state.page === page ? 'page' : 'false') +
          '">' +
          label +
          '</a>'
        );
      })
      .join('') +
    '</nav>'
  );
}

function helpTag(label: string, tooltip: string): string {
  return (
    '<span class="help-tag" tabindex="0" role="note" title="' +
    tooltip +
    '" data-tip="' +
    tooltip +
    '" aria-label="' +
    label +
    ': ' +
    tooltip +
    '">' +
    label +
    '</span>'
  );
}

function playPrimer(): string {
  return [
    '<section class="play-primer" aria-label="Quick start">',
    '<div><span class="eyebrow">Start here</span><h2>Use it like a sidecar scorekeeper</h2>',
    '<p>Do these in order: match the open tiles, enter the dice total, read the top recommendation, then apply the move.</p></div>',
    '<ol>',
    '<li><strong>Board</strong><span>Bright tiles are open. Tap a tile when your real board differs.</span></li>',
    '<li><strong>Roll</strong><span>Enter the total shown on the dice, not each die separately.</span></li>',
    '<li><strong>Move</strong><span>The green recommendation is the best move for the selected objective.</span></li>',
    '</ol>',
    '</section>',
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
          '" title="' +
          workflowHelp(index) +
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

function workflowHelp(index: number): string {
  return [
    'Click tiles until the open board matches the physical game.',
    'Enter or tap the dice total you rolled.',
    'The top recommendation is ranked by the selected objective.',
    'Apply best closes the recommended tiles and advances the board.',
  ][index];
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
    '<div><span class="eyebrow">Current position</span>' +
      helpTag(
        '?',
        'This is the current board plus the selected dice total. Follow the large instruction first.',
      ) +
      '<h2>' +
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
      '" title="Toggle tile ' +
      tile +
      ' open or closed." aria-label="' +
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
    '<p class="line-help inverted">Tap a tile to mark it open or closed. Yellow outlined tiles are the current best move.</p>',
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
        '" title="Set the dice total to ' +
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
    '<div class="section-heading tight"><div><span class="eyebrow">Dice</span>' +
      helpTag(
        '?',
        'Use the total on the dice, not each die separately. The app changes to 1d6 only when the one-die rule is active and tiles 7-9 are closed.',
      ) +
      '<h2>' +
      modeLabel +
      ' total</h2></div>',
    '<div class="panel-actions"><button id="random-roll-btn" class="button button-primary" type="button" title="Generate a random legal dice total for the current dice mode.">Roll</button>' +
      (state.roll !== null
        ? '<button id="clear-roll-btn" class="button button-quiet" type="button" title="Clear the selected dice total.">Clear</button>'
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
    '<p class="line-help">Pick the total first. Legal moves appear immediately in the move advisor.</p>',
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
      '<span class="eyebrow">Move advisor</span>' +
        helpTag(
          '?',
          'The advisor compares every legal tile combination that sums to the selected roll.',
        ) +
        '<h2>Pick a dice total</h2>',
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
      '<span class="eyebrow">Move advisor</span>' +
        helpTag(
          '?',
          'No open tile combination sums to this roll, so the turn ends with the displayed score.',
        ) +
        '<h2>No legal move</h2><p>Final score: ' +
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
      '" title="Close the recommended tile combination on the board.">Apply best</button></div>',
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
    '<button class="move-row" type="button" data-move-mask="' +
      rankedMove.move.mask +
      '" title="Apply this alternative move.">',
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
        '" title="' +
        meta.description +
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
    '<div class="section-heading tight"><div><span class="eyebrow">Strategy</span>' +
      helpTag(
        '?',
        'Change the objective when you care about a different kind of optimal play. Lowest score is the default scoring strategy.',
      ) +
      '<h2>Objective</h2></div></div>',
    '<div class="objective-list">' + objectives + '</div>',
    '<label class="switch-row"><span><strong>One-die rule</strong><small>' +
      ruleStatus +
      '</small></span><input id="one-die-toggle" type="checkbox" ' +
      (state.useOneDie ? 'checked' : '') +
      ' /></label>',
    '<p class="line-help">Lowest score ranks by expected final points. Shut chance ranks by probability of score 0. Survival ranks by avoiding an immediate dead roll.</p>',
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
    '<span class="eyebrow">State analysis</span>' +
      helpTag(
        '?',
        'These numbers describe the current board before choosing the next move. They update after every tile, roll, and objective change.',
      ),
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
    '<p class="line-help">Expected final score is lower-is-better. The two percentages are higher-is-better.</p>',
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
    '<div class="section-heading tight"><div><span class="eyebrow">Dice odds</span>' +
      helpTag(
        '?',
        'Bars show the probability of each possible total. Two dice peak at 7; one die is uniform.',
      ) +
      '<h2>' +
      (oneDie ? 'One die' : 'Two dice') +
      '</h2></div></div>',
    '<div class="probability-chart">' + bars + '</div>',
    '</section>',
  ].join('');
}

function rulesPanel(): string {
  return [
    '<section class="panel rules-panel" aria-label="Rules variant">',
    '<span class="eyebrow">Rules variant</span>' +
      helpTag(
        '?',
        'The active policy table controls whether the dynamic program assumes two dice only or allows one die once 7-9 are closed.',
      ),
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

function guidePage(): string {
  return [
    '<main class="content-page" aria-label="How to use the strategy app">',
    '<section class="content-hero">',
    '<span class="eyebrow">Manual</span><h2>How to use the advisor without guessing</h2>',
    '<p>This app is not a dice game simulator. It is an optimal move table for the real board in front of you. Keep the app state matched to the physical tiles, then let the advisor rank the legal moves.</p>',
    '</section>',
    '<section class="walkthrough-panel" aria-label="Thirty second walkthrough">',
    '<div><span class="eyebrow">30-second flow</span><h3>One turn, end to end</h3></div>',
    '<ol>',
    '<li><strong>Look at your board.</strong><span>If tiles 1, 2, 4, and 9 are still up, those exact tiles should be bright in the app.</span></li>',
    '<li><strong>Roll the dice.</strong><span>If the dice show 3 and 4, enter 7. Do not enter each die separately.</span></li>',
    '<li><strong>Read the top card.</strong><span>If it says Close 7, that is the recommended tile set for the selected objective.</span></li>',
    '<li><strong>Apply best.</strong><span>The app closes those tiles and clears the roll so you can start the next turn.</span></li>',
    '</ol>',
    '</section>',
    '<section class="guide-grid">',
    guideCard(
      '1',
      'Match the board',
      'Open means the tile is still standing and can be closed. Closed means it is already down. The app must match before the advice is meaningful.',
    ),
    guideCard(
      '2',
      'Enter the dice total',
      'Use the sum of the dice. With two dice, valid totals are 2-12. With the one-die rule active, valid totals are 1-6.',
    ),
    guideCard(
      '3',
      'Choose an objective',
      'Lowest score is normal scoring strategy. Shut chance maximizes score-zero attempts. Survival is for avoiding an immediate dead roll.',
    ),
    guideCard(
      '4',
      'Apply a move',
      'The highlighted tile set is the top-ranked move. Alternative rows are legal too; click one if you intentionally want a different tradeoff.',
    ),
    '</section>',
    '<section class="paper-panel">',
    '<h3>Reading the numbers</h3>',
    '<div class="definition-list">',
    '<div><strong>EV</strong><span>Expected final score from the board after making the move. Lower is better.</span></div>',
    '<div><strong>P(shut)</strong><span>Probability of eventually closing every tile from that board. Higher is better.</span></div>',
    '<div><strong>P(survive)</strong><span>Probability that the next roll has at least one legal move. Higher means less immediate risk.</span></div>',
    '<div><strong>One-die rule</strong><span>If enabled, the app switches to one die only after tiles 7, 8, and 9 are closed.</span></div>',
    '</div>',
    '</section>',
    '</main>',
  ].join('');
}

function guideCard(step: string, title: string, body: string): string {
  return (
    '<article class="guide-card"><span>' +
    step +
    '</span><h3>' +
    title +
    '</h3><p>' +
    body +
    '</p></article>'
  );
}

function mathPage(): string {
  return [
    '<main class="content-page math-page" aria-label="Math behind the optimal strategy">',
    '<section class="math-hero">',
    '<div><span class="eyebrow">Math paper</span><h2>Optimal Shut the Box as dynamic programming</h2>',
    '<p>A board is a bitmask, a roll selects legal subsets, and each move jumps to a smaller state. That makes the whole strategy table computable exactly.</p></div>',
    '<div class="state-diagram" aria-label="State transition diagram">',
    '<span>state s</span><i>roll r</i><span>legal moves M(s,r)</span><i>choose m</i><span>s &amp; ~m</span>',
    '</div>',
    '</section>',
    '<section class="math-grid">',
    '<article class="paper-panel formula-panel">',
    '<span class="eyebrow">State encoding</span><h3>Tiles become a 9-bit vector</h3>',
    '<div class="bit-row" aria-label="Bitmask tiles">' +
      Array.from(
        { length: 9 },
        (_, index) => '<span><b>' + (index + 1) + '</b><small>2^' + index + '</small></span>',
      ).join('') +
      '</div>',
    '<p>Bit i is 1 when tile i + 1 is open. Full board is <code>0x1FF</code>; shut board is <code>0</code>.</p>',
    '</article>',
    '<article class="paper-panel formula-panel">',
    '<span class="eyebrow">Legal moves</span><h3>Only subsets that sum to the roll count</h3>',
    '<p class="formula">M(s,r) = { m subset s : sum tiles(m) = r }</p>',
    '<p>Applying a legal move removes those bits: <code>next = s &amp; ~m</code>.</p>',
    '</article>',
    '</section>',
    '<section class="paper-panel theorem-panel">',
    '<span class="eyebrow">Bellman equations</span><h3>The exact value functions</h3>',
    '<div class="equation-stack">',
    equationCard(
      'Expected score',
      'V_score(0) = 0',
      'V_score(s) = sum_r p(r) min_or_score(s,r)',
      'If no legal move exists, the terminal value is score(s). Otherwise choose the move with the smallest future score.',
    ),
    equationCard(
      'Shut probability',
      'V_shut(0) = 1',
      'V_shut(s) = sum_r p(r) max_or_zero(s,r)',
      'If no legal move exists, the contribution is 0. Otherwise choose the move with the largest chance of reaching state 0.',
    ),
    equationCard(
      'Survival',
      'V_survive(s) = sum_r p(r) 1[M(s,r) != empty]',
      'rank(m) = V_survive(s & ~m)',
      'This objective is intentionally short-horizon: it asks which move is least likely to die on the next roll.',
    ),
    '</div>',
    '</section>',
    '<section class="paper-panel proof-panel">',
    '<span class="eyebrow">Why it terminates</span><h3>Every move goes downhill</h3>',
    '<p>Every legal move closes at least one open tile. Therefore <code>s &amp; ~m &lt; s</code>. The engine can compute all 512 states in ascending order because every child state has already been solved.</p>',
    '<div class="dice-proof"><div><strong>2d6</strong><span>36 ordered outcomes, totals 2-12, peak mass at 7.</span></div><div><strong>1d6</strong><span>6 ordered outcomes, totals 1-6, uniform mass.</span></div></div>',
    '</section>',
    '</main>',
  ].join('');
}

function equationCard(title: string, base: string, recurrence: string, note: string): string {
  return (
    '<article class="equation-card"><h4>' +
    title +
    '</h4><pre><code>' +
    base +
    '\n' +
    recurrence +
    '</code></pre><p>' +
    note +
    '</p></article>'
  );
}

function attach(): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setPage(link.dataset.page as AppPage);
    });
  });

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

window.addEventListener('popstate', () => {
  state.page = currentPage();
  render();
});

render();
