import './style.css';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getRankedMoves, tileValue, diceDistribution } from './engine/index.js';
import { TWO_DICE_DP, ONE_DICE_DP } from './engine/dp.js';
import type { DPTables, Objective, RankedMove } from './engine/types.js';

interface AppState {
  gameState: number;
  roll: number | null;
  objective: Objective;
  diceMode: DiceMode;
  helpMode: HelpMode;
  page: AppPage;
}

type Snapshot = Pick<AppState, 'gameState' | 'roll' | 'objective' | 'diceMode' | 'helpMode'>;
interface SimulatorState {
  gameState: number;
  roll: number | null;
  diceMode: DiceMode;
  objective: Objective;
  turn: number;
  dieValues: [number, number | null];
  lastMove: RankedMove | null;
  log: string[];
  isRolling: boolean;
  autoplay: boolean;
  ended: boolean;
}

interface SimulatorRuntime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  frame: number;
  startedAt: number;
  dice: THREE.Group[];
  dispose: () => void;
}

const FULL_STATE = 0x1ff;
const HIGH_TILES_MASK = 0x1c0;
const STORAGE_KEY = 'shut-the-box-optimal-strategy:state:v1';
type AppPage = 'play' | 'guide' | 'math' | 'simulator';
type DiceMode = 'auto' | 'two' | 'one';
type HelpMode = 'guided' | 'compact';
const PAGE_PATHS: Record<AppPage, string> = {
  play: '/',
  guide: '/how-to-use',
  math: '/math',
  simulator: '/simulator',
};
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const DEPLOYED_BASE_PATH = '/shut-the-box-optimal-strategy';

const savedState = loadSavedState();
const state: AppState = {
  gameState: FULL_STATE,
  roll: null,
  objective: 'minimize_score',
  diceMode: 'auto',
  helpMode: 'compact',
  ...savedState,
  page: currentPage(),
};
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let lastNotice: string | null = null;
let rollDraft = state.roll === null ? '' : String(state.roll);
let simulatorRuntime: SimulatorRuntime | null = null;
let simulatorTimer: number | null = null;

const simulatorState: SimulatorState = {
  gameState: FULL_STATE,
  roll: null,
  diceMode: 'auto',
  objective: 'minimize_score',
  turn: 0,
  dieValues: [1, 1],
  lastMove: null,
  log: ['Ready: roll the dice to watch the advisor choose a legal move.'],
  isRolling: false,
  autoplay: false,
  ended: false,
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
  return (gameState & HIGH_TILES_MASK) === 0;
}

function activeOneDie(): boolean {
  if (state.diceMode === 'two') return false;
  return canUseOneDie(state.gameState);
}

function simulatorOneDie(): boolean {
  if (simulatorState.diceMode === 'two') return false;
  return canUseOneDie(simulatorState.gameState);
}

function activeDp(): DPTables {
  return state.diceMode === 'two' ? TWO_DICE_DP : ONE_DICE_DP;
}

function policyAllowsOneDie(): boolean {
  return state.diceMode !== 'two';
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
  if (state.roll < range.min || state.roll > range.max) {
    state.roll = null;
    rollDraft = '';
  }
}

function setRoll(value: number | null): void {
  state.roll = value;
  rollDraft = value === null ? '' : String(value);
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
  return getRankedMoves(state.gameState, state.roll, state.objective, policyAllowsOneDie());
}

function randomDie(): number {
  if (usesCryptoRandom()) return randomInt(6) + 1;
  return Math.ceil(Math.random() * 6);
}

function usesCryptoRandom(): boolean {
  return !globalThis.navigator?.userAgent.includes('jsdom') && !!globalThis.crypto?.getRandomValues;
}

function randomInt(maxExclusive: number): number {
  const cryptoApi = globalThis.crypto;
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    cryptoApi.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % maxExclusive;
}

function randomRoll(): number {
  if (activeOneDie()) return randomDie();
  return randomDie() + randomDie();
}

function randomDiceValues(oneDie: boolean): [number, number | null] {
  const first = randomDie();
  return oneDie ? [first, null] : [first, randomDie()];
}

function snapshotState(): Snapshot {
  return {
    gameState: state.gameState,
    roll: state.roll,
    objective: state.objective,
    diceMode: state.diceMode,
    helpMode: state.helpMode,
  };
}

function restoreSnapshot(snapshot: Snapshot): void {
  state.gameState = snapshot.gameState;
  state.roll = snapshot.roll;
  state.objective = snapshot.objective;
  state.diceMode = snapshot.diceMode;
  state.helpMode = snapshot.helpMode;
  rollDraft = snapshot.roll === null ? '' : String(snapshot.roll);
}

function isValidSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.gameState === 'number' &&
    candidate.gameState >= 0 &&
    candidate.gameState <= FULL_STATE &&
    (typeof candidate.roll === 'number' || candidate.roll === null) &&
    ['minimize_score', 'maximize_shutting', 'maximize_survival'].includes(
      String(candidate.objective),
    ) &&
    ['auto', 'two', 'one'].includes(String(candidate.diceMode)) &&
    (candidate.helpMode === undefined || ['guided', 'compact'].includes(String(candidate.helpMode)))
  );
}

function loadSavedState(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSnapshot(parsed)) return null;
    return { ...parsed, helpMode: parsed.helpMode ?? 'compact' };
  } catch {
    return null;
  }
}

function saveState(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotState()));
  } catch {
    // Storage is optional; the strategy app still works without it.
  }
}

function commitAction(notice: string, mutate: () => void): void {
  undoStack.push(snapshotState());
  if (undoStack.length > 40) undoStack = undoStack.slice(-40);
  redoStack = [];
  mutate();
  normalizeRoll();
  lastNotice = notice;
  saveState();
  render();
}

function undo(): void {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(snapshotState());
  restoreSnapshot(previous);
  lastNotice = 'Undid the last board change.';
  saveState();
  render();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshotState());
  restoreSnapshot(next);
  lastNotice = 'Redid the board change.';
  saveState();
  render();
}

function moveMaskLabel(mask: number): string {
  return Array.from({ length: 9 }, (_, index) => index + 1)
    .filter((tile) => (mask & (1 << (tile - 1))) !== 0)
    .join(' + ');
}

function currentPage(): AppPage {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const base = path.startsWith(DEPLOYED_BASE_PATH) ? DEPLOYED_BASE_PATH : BASE_PATH;
  const route = base && path.startsWith(base) ? path.slice(base.length) || '/' : path;
  const normalized = route.replace(/\/$/, '') || '/';
  if (normalized === PAGE_PATHS.math) return 'math';
  if (normalized === PAGE_PATHS.guide) return 'guide';
  if (normalized === PAGE_PATHS.simulator) return 'simulator';
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
  disposeSimulatorScene();
  normalizeRoll();
  document.getElementById('app')!.innerHTML = buildApp();
  attach();
  if (state.page === 'simulator') initSimulatorScene();
}

function buildApp(): string {
  const ranked = rankedMoves();
  return ['<div class="app-shell">', topBar(), pageBody(ranked), '</div>'].join('');
}

function pageBody(ranked: RankedMove[]): string {
  if (state.page === 'guide') return guidePage();
  if (state.page === 'math') return mathPage();
  if (state.page === 'simulator') return simulatorPage();
  return playPage(ranked);
}

function playPage(ranked: RankedMove[]): string {
  return [
    '<main class="app-layout ' + (state.helpMode === 'compact' ? 'is-compact' : 'is-guided') + '">',
    state.helpMode === 'guided' ? viewModeSwitch() + playPrimer() : '',
    state.helpMode === 'guided' ? workflowPanel(ranked) : '',
    noticePanel(),
    '<section class="strategy-stage" aria-label="Optimal move workspace">',
    '<div class="board-stack">',
    state.helpMode === 'guided' ? gameSummary(ranked) : '',
    tileBoard(ranked),
    dicePanel(),
    '</div>',
    '<div class="action-stack">',
    advisorPanel(ranked),
    '</div>',
    '</section>',
    state.helpMode === 'guided'
      ? '<section class="analysis-strip" aria-label="Strategy controls and analysis">' +
        controlsPanel() +
        metricsPanel() +
        probabilityPanel() +
        rulesPanel() +
        '</section>'
      : '',
    '</main>',
  ].join('');
}

function viewModeSwitch(): string {
  return [
    '<section class="view-mode-switch" aria-label="Display mode">',
    '<div><span class="eyebrow">View</span><strong>' +
      (state.helpMode === 'guided' ? 'Full help' : 'Compact board') +
      '</strong></div>',
    '<div class="view-mode-actions" role="group" aria-label="Choose display mode">',
    viewModeButton('guided', 'Full help', 'Show walkthrough, stepper, explanations, and analysis.'),
    viewModeButton(
      'compact',
      'Compact board',
      'Hide tutorial sections and keep the play surface first.',
    ),
    '</div>',
    '</section>',
  ].join('');
}

function viewModeButton(mode: HelpMode, label: string, title: string): string {
  return (
    '<button class="view-mode-option' +
    (state.helpMode === mode ? ' is-active' : '') +
    '" type="button" data-help-mode="' +
    mode +
    '" title="' +
    title +
    '">' +
    label +
    '</button>'
  );
}

function noticePanel(): string {
  if (!lastNotice) return '';
  return '<section class="notice-panel" role="status">' + lastNotice + '</section>';
}

function topBar(): string {
  const score = tileValue(state.gameState);
  const rulesMode = diceModeStatus();
  return [
    '<header class="top-bar">',
    '<div class="brand-mark" aria-hidden="true"><span>STB</span></div>',
    '<div class="brand-copy"><h1>Shut the Box</h1><p>Move helper</p></div>',
    pageNav(),
    '<div class="top-actions">',
    '<div class="score-pill ' +
      scoreTone(score) +
      '"><span>Open score</span><strong>' +
      score +
      '</strong></div>',
    '<div class="mode-pill">' + rulesMode + '</div>',
    '<button id="help-mode-btn" class="button button-quiet" type="button" title="Toggle between guided help and compact returning-player mode.">' +
      (state.helpMode === 'guided' ? 'Hide help' : 'Show help') +
      '</button>',
    '<button id="reset-btn" class="button button-quiet" type="button" title="Reset the board to all tiles open and clear the roll.">New game</button>',
    '</div>',
    '</header>',
  ].join('');
}

function diceModeStatus(): string {
  if (state.diceMode === 'two') return 'Manual: 2 dice';
  if (state.diceMode === 'one') return activeOneDie() ? 'Manual: 1 die' : '1 die unavailable';
  return activeOneDie() ? 'Auto: 1 die suggested' : 'Auto: 2 dice';
}

function pageNav(): string {
  const pages: Array<[AppPage, string]> = [
    ['play', 'Play'],
    ['simulator', 'Simulator'],
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
    '<li><strong>Board</strong><span>Bright tiles are still up. Tap any tile that is already down.</span></li>',
    '<li><strong>Roll</strong><span>Enter the total shown on the dice, not each die separately.</span></li>',
    '<li><strong>Move</strong><span>The highlighted tiles are the recommendation to close.</span></li>',
    '</ol>',
    '</section>',
  ].join('');
}

function workflowPanel(ranked: RankedMove[]): string {
  const focus = guidedFocus(ranked);
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
    '<section class="workflow-panel" aria-label="Guided turn mode">' +
    (state.helpMode === 'guided'
      ? '<div class="workflow-focus"><span class="eyebrow">Guided turn mode</span><h2>Next step: ' +
        focus.title +
        '</h2><p>' +
        focus.body +
        '</p></div>'
      : '') +
    '<div class="workflow-steps">' +
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
    '</div></section>'
  );
}

function guidedFocus(ranked: RankedMove[]): { title: string; body: string } {
  if (state.gameState === 0) {
    return {
      title: 'start a new game',
      body: 'The board is shut. Use New game when you want to solve another round.',
    };
  }
  if (state.roll === null) {
    return {
      title: 'enter the roll',
      body: 'Match the board first, then tap a roll chip, type the total, press a number key, or use Roll.',
    };
  }
  if (ranked[0]) {
    return {
      title: 'apply the best move',
      body: 'The highlighted tiles are the current recommendation. Press Enter or click Apply best.',
    };
  }
  return {
    title: 'record the dead roll',
    body: 'No open tile combination matches this total. The shown score is the turn result.',
  };
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
  const openLabel =
    open.length === 0 ? 'No tiles remain up.' : 'Tiles still up: ' + open.join(', ');

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
    const label = isOpen ? 'Tile ' + tile + ' still up' : 'Tile ' + tile + ' already down';
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
    '<div class="section-heading"><div><span class="eyebrow">1. Match your box</span><h2>Tiles still up</h2></div>',
    boardBadge(ranked),
    '</div>',
    boardTools(),
    '<div class="tile-row">' + tiles + '</div>',
    '<p class="line-help inverted">Tap tiles that are already down on your real board. Highlighted tiles are the move to close.</p>',
    '</section>',
  ].join('');
}

function boardTools(): string {
  return [
    '<div class="board-tools" aria-label="Board shortcuts">',
    '<button id="all-open-btn" class="button button-quiet" type="button" title="Set every tile to still up.">All up</button>',
    '<button id="clear-high-btn" class="button button-quiet" type="button" title="Mark tiles 7, 8, and 9 as already down.">7-9 down</button>',
    '<button id="demo-turn-btn" class="button button-quiet" type="button" title="Load a sample board and roll.">Demo turn</button>',
    '<button id="undo-btn" class="button button-quiet" type="button" ' +
      (undoStack.length === 0 ? 'disabled aria-disabled="true"' : '') +
      ' title="Undo the last board or setting change.">Undo</button>',
    '<button id="redo-btn" class="button button-quiet" type="button" ' +
      (redoStack.length === 0 ? 'disabled aria-disabled="true"' : '') +
      ' title="Redo the last undone change.">Redo</button>',
    '</div>',
  ].join('');
}

function boardBadge(ranked: RankedMove[]): string {
  if (state.gameState === 0) return '<span class="status-badge success">Shut</span>';
  if (state.roll !== null && ranked.length === 0)
    return '<span class="status-badge danger">No move</span>';
  if (ranked[0]) return '<span class="status-badge good">Close marked tiles</span>';
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
    '<div class="section-heading tight"><div><span class="eyebrow">2. Enter roll</span>' +
      helpTag(
        '?',
        'Use the total on the dice, not each die separately. Auto mode suggests 1d6 after tiles 7-9 are closed; manual dice mode can override it.',
      ) +
      '<h2>' +
      (state.roll === null ? 'What did you roll?' : 'Roll ' + state.roll) +
      '</h2><p class="panel-subtitle">' +
      modeLabel +
      ' totals</p></div>',
    '<div class="panel-actions"><button id="random-roll-btn" class="button button-primary" type="button" title="Generate a random legal dice total for the current dice mode.">Roll</button>' +
      (state.roll !== null
        ? '<button id="clear-roll-btn" class="button button-quiet" type="button" title="Clear the selected dice total.">Clear</button>'
        : '') +
      '</div></div>',
    diceModeControl(),
    oneDieCallout(),
    '<label class="number-field"><span>Total</span><input id="dice-input" type="number" min="' +
      range.min +
      '" max="' +
      range.max +
      '" inputmode="numeric" value="' +
      rollDraft +
      '" placeholder="' +
      range.min +
      '-' +
      range.max +
      '" /></label>',
    '<div class="roll-grid">' + chips + '</div>',
    '<div class="dice-footer">' + diceVisual() + '</div>',
    '<p class="line-help">Tap the dice total. The best move appears on the right.</p>',
    '</section>',
  ].join('');
}

function oneDieCallout(): string {
  if (!canUseOneDie(state.gameState)) return '';
  const message =
    state.diceMode === 'auto'
      ? 'One die is available. Auto selected 1d6, and you can still force 2d6.'
      : state.diceMode === 'two'
        ? 'One die is available, but manual 2 dice is active.'
        : 'Manual 1d6 is active for the rest of this board state.';
  return '<div class="one-die-callout" role="note">' + message + '</div>';
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
      '<span class="eyebrow">3. Best move</span><h2>Box shut</h2><p>Final score: 0.</p>',
      '</section>',
    ].join('');
  }

  if (state.roll === null) {
    return [
      '<section class="panel advisor-panel" aria-label="Move advisor">',
      '<span class="eyebrow">3. Best move</span>' +
        helpTag(
          '?',
          'The advisor compares every legal tile combination that sums to the selected roll.',
        ) +
        '<h2>Waiting for roll</h2>',
      '<p class="muted">Tap the number you rolled. The tiles to close will light up.</p>',
      '</section>',
    ].join('');
  }

  if (ranked.length === 0) {
    const score = tileValue(state.gameState);
    return [
      '<section class="panel advisor-panel danger-state" aria-label="Move advisor">',
      '<span class="eyebrow">3. Best move</span>' +
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
    '<div class="section-heading tight"><div><span class="eyebrow">3. Best move</span><h2>Close ' +
      moveLabel(best) +
      '</h2></div>',
    '<button class="button button-primary" type="button" data-move-mask="' +
      best.move.mask +
      '" title="Mark the recommended tiles as down.">Close these tiles</button></div>',
    '<div class="best-move-card"><div><span class="rank-label">Optimal</span><strong>' +
      best.explanation +
      '</strong><p>' +
      moveExplanation(best) +
      '</p></div></div>',
    moveWhyPanel(best, ranked[1]),
    alternatives
      ? '<div class="move-table" aria-label="Alternative moves"><div class="table-caption">Compare alternatives</div>' +
        alternatives +
        '</div>'
      : '<p class="muted compact">Only one legal move for this roll.</p>',
    '</section>',
  ].join('');
}

function moveWhyPanel(best: RankedMove, nextBest?: RankedMove): string {
  const comparison = nextBest
    ? 'The next alternative is Close ' +
      moveLabel(nextBest) +
      ', rated ' +
      nextBest.explanation +
      '.'
    : 'There is no second legal move for this roll.';
  return [
    '<details class="why-panel"' + (state.helpMode === 'guided' ? ' open' : '') + '>',
    '<summary>Why this move?</summary>',
    '<p>Close ' +
      moveLabel(best) +
      ' because it is the best-ranked legal subset for ' +
      objectiveMeta[state.objective].shortLabel +
      '. ' +
      comparison +
      '</p>',
    '</details>',
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

  return [
    '<section class="panel controls-panel" aria-label="Strategy controls">',
    '<div class="section-heading tight"><div><span class="eyebrow">Strategy</span>' +
      helpTag(
        '?',
        'Change the objective when you care about a different kind of optimal play. Lowest score is the default scoring strategy.',
      ) +
      '<h2>Objective</h2></div></div>',
    '<div class="objective-list">' + objectives + '</div>',
    '<p class="line-help">Lowest score ranks by expected final points. Shut chance ranks by probability of score 0. Survival ranks by avoiding an immediate dead roll.</p>',
    '</section>',
  ].join('');
}

function diceModeControl(): string {
  const eligible = canUseOneDie(state.gameState);
  const modes: Array<{ mode: DiceMode; label: string; detail: string; disabled?: boolean }> = [
    {
      mode: 'auto',
      label: 'Auto',
      detail: eligible ? 'Suggests 1 die now' : 'Uses 2 dice until 7-9 close',
    },
    {
      mode: 'two',
      label: 'Two dice',
      detail: 'Force 2d6 totals',
    },
    {
      mode: 'one',
      label: 'One die',
      detail: eligible ? 'Manual 1d6 totals' : 'Available after 7-9 close',
      disabled: !eligible,
    },
  ];

  return (
    '<div class="dice-mode-control" aria-label="Dice mode control"><div><strong>Dice mode</strong><small>' +
    diceModeStatus() +
    '</small></div><div class="dice-mode-list">' +
    modes
      .map(({ mode, label, detail, disabled }) => {
        const active = state.diceMode === mode ? ' is-active' : '';
        const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';
        return (
          '<button class="dice-mode-option' +
          active +
          '" type="button" data-dice-mode="' +
          mode +
          '"' +
          disabledAttr +
          ' title="' +
          detail +
          '"><span>' +
          label +
          '</span><small>' +
          detail +
          '</small></button>'
        );
      })
      .join('') +
    '</div></div>'
  );
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
    '<div class="rule-line"><span>Dice mode</span><strong>' + diceModeStatus() + '</strong></div>',
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
      'Use the sum of the dice. Auto mode uses 2-12 until tiles 7-9 close, then suggests 1-6. You can force two dice or manually choose one die.',
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
    '<div><strong>Dice mode</strong><span>Auto suggests one die after tiles 7, 8, and 9 are closed. You can also force two dice or manually select one die when legal.</span></div>',
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

function simulatorPage(): string {
  const oneDie = simulatorOneDie();
  const ranked = simulatorRankedMoves();
  const best = ranked[0] ?? simulatorState.lastMove;
  const score = tileValue(simulatorState.gameState);
  const terminal = simulatorTerminal();
  return [
    '<main class="simulator-page" aria-label="3D Shut the Box simulator">',
    '<section class="simulator-shell">',
    '<div id="sim-canvas" class="sim-canvas" aria-label="3D board and dice"></div>',
    '<div class="sim-title-card"><span class="eyebrow">Simulator</span><h2>3D Shut the Box</h2><p>' +
      (oneDie ? 'One die active' : 'Two dice active') +
      ' · Turn ' +
      simulatorState.turn +
      '</p></div>',
    '<aside class="sim-overlay" aria-label="Simulator stats">',
    '<div class="sim-overlay-header"><span class="eyebrow">Live stats</span><strong>' +
      simulatorOutcomeLabel(ranked) +
      '</strong></div>',
    '<div class="sim-stat-grid">',
    simStat('Score up', String(score)),
    simStat('Roll', simulatorState.roll === null ? '-' : String(simulatorState.roll)),
    simStat('Dice', oneDie ? '1d6' : '2d6'),
    simStat('Random', usesCryptoRandom() ? 'Crypto d6' : 'Fallback d6'),
    simStat('Best move', best ? moveLabel(best) : '-'),
    simStat('EV', activeSimulatorDp().expectedScore[simulatorState.gameState].toFixed(2)),
    simStat(
      'Shut chance',
      formatPercent(activeSimulatorDp().shutProbability[simulatorState.gameState]),
    ),
    '</div>',
    best
      ? '<div class="sim-best"><span>Strategy correlation</span><p>Close ' +
        moveLabel(best) +
        ' leaves EV ' +
        activeSimulatorDp().expectedScore[simulatorState.gameState & ~best.move.mask].toFixed(2) +
        ', shut ' +
        formatPercent(
          activeSimulatorDp().shutProbability[simulatorState.gameState & ~best.move.mask],
        ) +
        ', survive ' +
        formatPercent(
          activeSimulatorDp().survivalProbability[simulatorState.gameState & ~best.move.mask],
        ) +
        '.</p></div>'
      : '<div class="sim-best"><span>Strategy correlation</span><p>Roll to generate the next legal strategy step.</p></div>',
    '<div class="sim-controls" aria-label="Simulator controls">',
    '<button id="sim-roll-btn" class="button button-primary" type="button"' +
      (terminal ? ' disabled aria-disabled="true"' : '') +
      '>' +
      (simulatorState.isRolling ? 'Rolling...' : terminal ? 'Game ended' : 'Roll turn') +
      '</button>',
    '<button id="sim-auto-btn" class="button button-quiet" type="button"' +
      (terminal ? ' disabled aria-disabled="true"' : '') +
      '>' +
      (simulatorState.autoplay ? 'Pause auto' : 'Auto-play') +
      '</button>',
    '<button id="sim-reset-btn" class="button button-quiet" type="button">Reset</button>',
    '</div>',
    '<div class="sim-readout"><span>' +
      (terminal ? 'End state' : 'Rules') +
      '</span><p>' +
      (terminal
        ? 'This run is finished. Reset to start another 3D game.'
        : 'Roll, close the best legal tile set, then repeat until the box shuts or no legal move remains.') +
      '</p></div>',
    '<ol class="sim-log">' +
      simulatorState.log.map((entry) => '<li>' + entry + '</li>').join('') +
      '</ol>',
    '</aside>',
    '</section>',
    '</main>',
  ].join('');
}

function simStat(label: string, value: string): string {
  return '<div><span>' + label + '</span><strong>' + value + '</strong></div>';
}

function simulatorOutcomeLabel(ranked: RankedMove[]): string {
  if (simulatorState.gameState === 0) return 'Box shut';
  if (simulatorState.ended) return 'Game over';
  if (simulatorState.isRolling) return 'Dice in motion';
  if (simulatorState.roll === null) return 'Ready to roll';
  if (ranked[0]) return 'Close ' + moveLabel(ranked[0]);
  return 'No legal move';
}

function simulatorTerminal(): boolean {
  return simulatorState.ended || simulatorState.gameState === 0;
}

function activeSimulatorDp(): DPTables {
  return simulatorState.diceMode === 'two' || !canUseOneDie(simulatorState.gameState)
    ? TWO_DICE_DP
    : ONE_DICE_DP;
}

function simulatorRankedMoves(): RankedMove[] {
  if (simulatorState.roll === null || simulatorState.gameState === 0) return [];
  return getRankedMoves(
    simulatorState.gameState,
    simulatorState.roll,
    simulatorState.objective,
    simulatorState.diceMode !== 'two',
  );
}

function resetSimulator(): void {
  simulatorState.gameState = FULL_STATE;
  simulatorState.roll = null;
  simulatorState.diceMode = 'auto';
  simulatorState.objective = 'minimize_score';
  simulatorState.turn = 0;
  simulatorState.dieValues = [1, 1];
  simulatorState.lastMove = null;
  simulatorState.isRolling = false;
  simulatorState.autoplay = false;
  simulatorState.ended = false;
  simulatorState.log = ['Reset: all tiles are standing.'];
  stopSimulatorTimer();
  render();
}

function simulatorRollTurn(): void {
  if (simulatorState.isRolling || simulatorTerminal()) return;
  const oneDie = simulatorOneDie();
  const dice = randomDiceValues(oneDie);
  const roll = dice[0] + (dice[1] ?? 0);
  simulatorState.isRolling = true;
  simulatorState.roll = roll;
  simulatorState.dieValues = dice;
  simulatorState.turn += 1;
  simulatorState.lastMove = null;
  simulatorState.log = [
    'Turn ' +
      simulatorState.turn +
      ': rolled ' +
      roll +
      ' with ' +
      (oneDie ? 'one die.' : 'two dice.'),
    ...simulatorState.log,
  ].slice(0, 7);
  render();
  window.setTimeout(() => finishSimulatorRoll(), 950);
}

function finishSimulatorRoll(): void {
  const ranked = simulatorRankedMoves();
  simulatorState.isRolling = false;
  if (ranked[0]) {
    simulatorState.lastMove = ranked[0];
    simulatorState.gameState &= ~ranked[0].move.mask;
    simulatorState.log = [
      'Closed ' +
        moveLabel(ranked[0]) +
        '; score up is now ' +
        tileValue(simulatorState.gameState) +
        '.',
      ...simulatorState.log,
    ].slice(0, 7);
    simulatorState.roll = null;
    if (canUseOneDie(simulatorState.gameState) && simulatorState.diceMode === 'auto') {
      simulatorState.dieValues = [simulatorState.dieValues[0], null];
      simulatorState.log = [
        'Tiles 7-9 are down; one die is now active.',
        ...simulatorState.log,
      ].slice(0, 7);
    }
  } else {
    simulatorState.log = [
      'No legal move for ' +
        simulatorState.roll +
        '; final score is ' +
        tileValue(simulatorState.gameState) +
        '.',
      ...simulatorState.log,
    ].slice(0, 7);
    simulatorState.autoplay = false;
    simulatorState.ended = true;
  }
  if (simulatorState.gameState === 0) {
    simulatorState.log = ['Box shut in 3D. Final score 0.', ...simulatorState.log].slice(0, 7);
    simulatorState.autoplay = false;
    simulatorState.ended = true;
  }
  render();
  if (simulatorState.autoplay && !simulatorTerminal()) {
    simulatorTimer = window.setTimeout(() => simulatorRollTurn(), 650);
  }
}

function stopSimulatorTimer(): void {
  if (simulatorTimer !== null) {
    window.clearTimeout(simulatorTimer);
    simulatorTimer = null;
  }
}

/* v8 ignore start -- WebGL drawing is validated with real browser canvas checks. */
function disposeSimulatorScene(): void {
  if (!simulatorRuntime) return;
  window.cancelAnimationFrame(simulatorRuntime.frame);
  simulatorRuntime.dispose();
  simulatorRuntime = null;
}

function initSimulatorScene(): void {
  const mount = document.getElementById('sim-canvas');
  if (!mount) return;
  if (typeof WebGLRenderingContext === 'undefined') {
    mount.innerHTML = '<div class="sim-fallback">3D table renders in a browser with WebGL.</div>';
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03070b);
  scene.fog = new THREE.Fog(0x03070b, 10, 24);
  const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 100);
  camera.position.set(0, 7.4, 10.4);
  camera.lookAt(0, 0.08, -0.25);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    mount.innerHTML =
      '<div class="sim-fallback">3D rendering is unavailable here, but the simulator controls and stats still work.</div>';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.replaceChildren(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(4.8, 8.5, 5.5);
  key.castShadow = true;
  scene.add(key);
  const rim = new THREE.PointLight(0x6ee7b7, 1.9, 18);
  rim.position.set(-4.8, 3.2, -3.6);
  scene.add(rim);
  const warm = new THREE.PointLight(0xfbbf24, 1.15, 14);
  warm.position.set(4.5, 2.6, 3.2);
  scene.add(warm);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(12.2, 0.34, 7.0),
    new THREE.MeshStandardMaterial({ color: 0x4a2919, roughness: 0.78 }),
  );
  table.position.y = -0.25;
  table.receiveShadow = true;
  scene.add(table);

  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(11.2, 0.08, 6.0),
    new THREE.MeshStandardMaterial({
      color: 0x0f6b52,
      emissive: 0x03251d,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  felt.position.y = -0.02;
  felt.receiveShadow = true;
  scene.add(felt);

  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x704126,
    roughness: 0.55,
    metalness: 0.04,
  });
  [
    [0, 0.22, -3.42, 12.6, 0.72, 0.34],
    [0, 0.22, 3.42, 12.6, 0.72, 0.34],
    [-6.18, 0.22, 0, 0.34, 0.72, 7.15],
    [6.18, 0.22, 0, 0.34, 0.72, 7.15],
  ].forEach(([x, y, z, w, h, d]) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), railMaterial);
    rail.position.set(x, y, z);
    scene.add(rail);
  });

  const laneMaterial = new THREE.MeshBasicMaterial({
    color: 0x8cf7c9,
    transparent: true,
    opacity: 0.18,
  });
  for (let index = 0; index < 10; index += 1) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 5.1), laneMaterial);
    line.position.set(-4.92 + index * 0.84, 0.04, -0.2);
    scene.add(line);
  }

  for (let tile = 1; tile <= 9; tile += 1) {
    scene.add(createSimTile(tile, (simulatorState.gameState & (1 << (tile - 1))) !== 0));
  }

  const dice = createSimDice();
  dice.forEach((die) => scene.add(die));

  const startedAt = performance.now();
  const runtime: SimulatorRuntime = {
    renderer,
    scene,
    frame: 0,
    startedAt,
    dice,
    dispose: () => {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    },
  };
  simulatorRuntime = runtime;

  const animate = () => {
    const elapsed = (performance.now() - runtime.startedAt) / 1000;
    runtime.dice.forEach((die, index) => {
      if (simulatorState.isRolling) {
        die.rotation.x = elapsed * (5.5 + index);
        die.rotation.y = elapsed * (6.5 + index * 0.7);
        die.rotation.z = elapsed * (4.8 + index * 0.9);
        die.position.x = (index === 0 ? -0.8 : 0.8) + Math.sin(elapsed * 8 + index) * 0.55;
        die.position.z = -0.1 + Math.cos(elapsed * 7 + index) * 0.45;
      } else {
        const finalRotation = dieFinalRotation(Number(die.userData.value));
        die.rotation.x = finalRotation.x;
        die.rotation.y = finalRotation.y + (index === 0 ? 0.18 : -0.16);
        die.rotation.z = finalRotation.z;
      }
    });
    renderer.render(scene, camera);
    runtime.frame = window.requestAnimationFrame(animate);
  };
  animate();
}

function createSimTile(tile: number, open: boolean): THREE.Group {
  const group = new THREE.Group();
  const tileMaterial = new THREE.MeshStandardMaterial({
    color: open ? 0xc5964d : 0x253849,
    emissive: open ? 0x1d1205 : 0x02070c,
    roughness: 0.54,
    metalness: 0.03,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: open ? 0x7a4a24 : 0x12202c,
    roughness: 0.68,
  });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.68, 1.35, 0.2, 5, 0.035), tileMaterial);
  body.position.y = open ? 0.62 : 0.02;
  body.rotation.x = open ? -0.2 : -Math.PI / 2;
  group.add(body);

  const lowerLip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.045, 0.035), edgeMaterial);
  lowerLip.position.set(0, open ? 0.05 : 0.2, open ? 0.1 : 0.64);
  lowerLip.rotation.x = body.rotation.x;
  group.add(lowerLip);

  const grooveMaterial = new THREE.MeshBasicMaterial({
    color: open ? 0x583514 : 0x88a4b8,
    transparent: true,
    opacity: open ? 0.44 : 0.28,
  });
  [-0.38, 0, 0.38].forEach((offset) => {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.018, 0.012), grooveMaterial);
    groove.position.set(0, open ? 0.62 + offset : 0.06, open ? 0.115 : 0.32 + offset * 0.28);
    groove.rotation.x = body.rotation.x;
    group.add(groove);
  });

  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.76, 18),
    new THREE.MeshStandardMaterial({ color: 0xc7b078, roughness: 0.35, metalness: 0.22 }),
  );
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, open ? 1.33 : 0.12, open ? -0.08 : -0.34);
  group.add(hinge);

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: numberTexture(String(tile), open ? '#f8fafc' : '#fde68a'),
      transparent: true,
    }),
  );
  label.scale.set(0.5, 0.5, 1);
  label.position.set(0, open ? 0.79 : 0.16, open ? 0.13 : 0.43);
  group.add(label);
  group.position.set(-4.55 + (tile - 1) * 0.84, 0, -1.85);
  return group;
}

function createSimDice(): THREE.Group[] {
  const values = simulatorState.dieValues;
  return values
    .map((value, index) => {
      if (value === null) return null;
      const group = new THREE.Group();
      const die = new THREE.Mesh(
        new RoundedBoxGeometry(0.88, 0.88, 0.88, 8, 0.12),
        new THREE.MeshPhysicalMaterial({
          color: 0xf8fafc,
          roughness: 0.22,
          metalness: 0.02,
          clearcoat: 0.55,
          clearcoatRoughness: 0.28,
        }),
      );
      die.castShadow = true;
      group.add(die);
      addDiePips(group);
      const bevelGlow = new THREE.Mesh(
        new RoundedBoxGeometry(0.895, 0.895, 0.895, 8, 0.125),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045 }),
      );
      group.add(bevelGlow);
      group.userData.value = value;
      group.position.set(index === 0 ? -0.8 : 0.8, 0.65, 0.05);
      return group;
    })
    .filter((group): group is THREE.Group => group !== null);
}

function dieFinalRotation(value: number): { x: number; y: number; z: number } {
  const rotations: Record<number, { x: number; y: number; z: number }> = {
    1: { x: 0, y: 0, z: 0 },
    2: { x: -Math.PI / 2, y: 0, z: 0 },
    3: { x: 0, y: 0, z: Math.PI / 2 },
    4: { x: 0, y: 0, z: -Math.PI / 2 },
    5: { x: Math.PI / 2, y: 0, z: 0 },
    6: { x: Math.PI, y: 0, z: 0 },
  };
  return rotations[value] ?? rotations[1];
}

function addDiePips(group: THREE.Group): void {
  addPipFace(group, 1, 'py');
  addPipFace(group, 6, 'ny');
  addPipFace(group, 2, 'pz');
  addPipFace(group, 5, 'nz');
  addPipFace(group, 3, 'px');
  addPipFace(group, 4, 'nx');
}

function addPipFace(
  group: THREE.Group,
  value: number,
  face: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz',
): void {
  const pipMap: Record<number, number[][]> = {
    1: [[0, 0]],
    2: [
      [-0.18, -0.18],
      [0.18, 0.18],
    ],
    3: [
      [-0.18, -0.18],
      [0, 0],
      [0.18, 0.18],
    ],
    4: [
      [-0.18, -0.18],
      [0.18, -0.18],
      [-0.18, 0.18],
      [0.18, 0.18],
    ],
    5: [
      [-0.18, -0.18],
      [0.18, -0.18],
      [0, 0],
      [-0.18, 0.18],
      [0.18, 0.18],
    ],
    6: [
      [-0.18, -0.22],
      [0.18, -0.22],
      [-0.18, 0],
      [0.18, 0],
      [-0.18, 0.22],
      [0.18, 0.22],
    ],
  };
  const offsets = pipMap[value] ?? pipMap[1];
  const material = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  offsets.forEach(([a, b]) => {
    const pip = new THREE.Mesh(new THREE.CircleGeometry(0.064, 24), material);
    const inset = 0.449;
    if (face === 'py') {
      pip.position.set(a, inset, b);
      pip.rotation.x = -Math.PI / 2;
    } else if (face === 'ny') {
      pip.position.set(a, -inset, b);
      pip.rotation.x = Math.PI / 2;
    } else if (face === 'pz') {
      pip.position.set(a, b, inset);
    } else if (face === 'nz') {
      pip.position.set(a, b, -inset);
      pip.rotation.y = Math.PI;
    } else if (face === 'px') {
      pip.position.set(inset, a, b);
      pip.rotation.y = Math.PI / 2;
    } else {
      pip.position.set(-inset, a, b);
      pip.rotation.y = -Math.PI / 2;
    }
    group.add(pip);
  });
}

function numberTexture(value: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(0, 0, 0, 0.82)';
  context.beginPath();
  context.roundRect(18, 20, 92, 88, 14);
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  context.lineWidth = 4;
  context.stroke();
  context.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  context.lineWidth = 2;
  context.strokeRect(28, 30, 72, 68);
  context.fillStyle = color;
  context.shadowColor = 'rgba(0, 0, 0, 0.85)';
  context.shadowBlur = 6;
  context.font = '900 72px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(value, 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
/* v8 ignore stop */

function attach(): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setPage(link.dataset.page as AppPage);
    });
  });

  document.getElementById('reset-btn')?.addEventListener('click', () => {
    state.gameState = FULL_STATE;
    setRoll(null);
    state.objective = 'minimize_score';
    state.diceMode = 'auto';
    state.helpMode = 'compact';
    undoStack = [];
    redoStack = [];
    lastNotice = 'New game loaded. Mark tiles that are down, then enter your roll.';
    saveState();
    render();
  });

  document.getElementById('help-mode-btn')?.addEventListener('click', toggleHelpMode);
  document.getElementById('restore-guidance-btn')?.addEventListener('click', toggleHelpMode);
  document.querySelectorAll<HTMLButtonElement>('[data-help-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setHelpMode(button.dataset.helpMode as HelpMode);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-objective]').forEach((button) => {
    button.addEventListener('click', () => {
      const label = objectiveMeta[button.dataset.objective as Objective].shortLabel;
      commitAction('Objective changed to ' + label + '.', () => {
        state.objective = button.dataset.objective as Objective;
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-dice-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      commitAction('Dice mode changed to ' + button.textContent?.trim() + '.', () => {
        state.diceMode = button.dataset.diceMode as DiceMode;
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-roll]').forEach((button) => {
    button.addEventListener('click', () => {
      commitAction('Roll set to ' + button.dataset.roll + '. Read the top move.', () => {
        setRoll(Number(button.dataset.roll));
      });
    });
  });

  document.getElementById('random-roll-btn')?.addEventListener('click', () => {
    const roll = randomRoll();
    commitAction('Rolled ' + roll + '. Read the top move.', () => {
      setRoll(roll);
    });
  });

  document.getElementById('clear-roll-btn')?.addEventListener('click', () => {
    commitAction('Roll cleared. Enter the next dice total.', () => {
      setRoll(null);
    });
  });

  document.getElementById('dice-input')?.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = input.value.trim();
    rollDraft = value;
    if (value === '') {
      commitAction('Roll cleared.', () => {
        setRoll(null);
      });
      return;
    }
    const roll = Number(value);
    const { min, max } = diceRange();
    if (Number.isInteger(roll) && roll >= min && roll <= max) {
      commitAction('Roll set to ' + roll + '.', () => {
        setRoll(roll);
      });
      return;
    }
    state.roll = null;
    input.setAttribute('aria-invalid', 'true');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-tile]').forEach((button) => {
    button.addEventListener('click', () => {
      const tile = Number(button.dataset.tile);
      const isOpen = (state.gameState & (1 << (tile - 1))) !== 0;
      commitAction('Tile ' + tile + (isOpen ? ' closed' : ' opened') + '. Roll cleared.', () => {
        state.gameState ^= 1 << (tile - 1);
        setRoll(null);
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-move-mask]').forEach((button) => {
    button.addEventListener('click', () => {
      const mask = Number(button.dataset.moveMask);
      commitAction('Closed ' + moveMaskLabel(mask) + '. Roll cleared. Next: roll again.', () => {
        state.gameState &= ~mask;
        setRoll(null);
      });
    });
  });

  document.getElementById('all-open-btn')?.addEventListener('click', () => {
    commitAction('All tiles set up. Enter your roll when the box matches.', () => {
      state.gameState = FULL_STATE;
      setRoll(null);
    });
  });

  document.getElementById('clear-high-btn')?.addEventListener('click', () => {
    commitAction('Marked 7 + 8 + 9 down. One die is now available.', () => {
      state.gameState &= ~HIGH_TILES_MASK;
      setRoll(null);
    });
  });

  document.getElementById('demo-turn-btn')?.addEventListener('click', () => {
    commitAction('Demo loaded: roll 7, then close the highlighted tiles.', () => {
      state.gameState = FULL_STATE;
      setRoll(7);
      state.objective = 'minimize_score';
      state.diceMode = 'auto';
    });
  });

  document.getElementById('undo-btn')?.addEventListener('click', undo);
  document.getElementById('redo-btn')?.addEventListener('click', redo);
  document.getElementById('sim-roll-btn')?.addEventListener('click', simulatorRollTurn);
  document.getElementById('sim-reset-btn')?.addEventListener('click', resetSimulator);
  document.getElementById('sim-auto-btn')?.addEventListener('click', () => {
    if (simulatorTerminal()) return;
    simulatorState.autoplay = !simulatorState.autoplay;
    if (simulatorState.autoplay) simulatorRollTurn();
    else stopSimulatorTimer();
    render();
  });

  document.onkeydown = handleShortcut;
}

function toggleHelpMode(): void {
  setHelpMode(state.helpMode === 'guided' ? 'compact' : 'guided');
}

function setHelpMode(mode: HelpMode): void {
  state.helpMode = mode;
  lastNotice =
    state.helpMode === 'compact'
      ? 'Game view on. Board, roll, and best move are first.'
      : 'Guidance restored. Help blocks are visible.';
  saveState();
  render();
}

function handleShortcut(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.tagName === 'SELECT' ||
    target?.isContentEditable
  ) {
    return;
  }

  const key = event.key.toLowerCase();
  if (/^[1-9]$/.test(key)) {
    const roll = Number(key);
    const { min, max } = diceRange();
    if (roll >= min && roll <= max) {
      event.preventDefault();
      commitAction('Roll set to ' + roll + '. Read the top move.', () => {
        setRoll(roll);
      });
    }
    return;
  }

  if (event.key === 'Enter') {
    const best = rankedMoves()[0];
    if (best) {
      event.preventDefault();
      commitAction(
        'Closed ' + moveMaskLabel(best.move.mask) + '. Roll cleared. Next: roll again.',
        () => {
          state.gameState &= ~best.move.mask;
          setRoll(null);
        },
      );
    }
    return;
  }

  if (key === 'r') {
    const roll = randomRoll();
    event.preventDefault();
    commitAction('Rolled ' + roll + '. Read the top move.', () => {
      setRoll(roll);
    });
    return;
  }

  if (key === 'u' || event.key === 'Backspace') {
    event.preventDefault();
    undo();
    return;
  }

  if (key === 'y' || (key === 'u' && event.shiftKey)) {
    event.preventDefault();
    redo();
  }
}

window.addEventListener('popstate', () => {
  state.page = currentPage();
  render();
});

render();
