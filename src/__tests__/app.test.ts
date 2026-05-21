import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_PATH = '/shut-the-box-optimal-strategy';
const STORAGE_KEY = 'shut-the-box-optimal-strategy:state:v1';

async function loadApp(path = '/'): Promise<HTMLElement> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', BASE_PATH + path);
  await import('../main.js');
  return document.getElementById('app')!;
}

function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element).not.toBeNull();
  element!.click();
}

function inputValue(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function pressKeyOn(selector: string, key: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element).not.toBeNull();
  element!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('strategy app shell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the play page with clear onboarding and real help text', async () => {
    const app = await loadApp();

    expect(app.textContent).toContain('Tiles still up');
    expect(app.textContent).toContain('What did you roll?');
    expect(app.textContent).toContain('Waiting for roll');
    expect(document.querySelector('.app-layout')?.className).toContain('is-compact');
    expect(document.querySelector('.play-primer')).toBeNull();
    expect(document.querySelector('#help-mode-btn')?.textContent).toContain('Show help');
    expect(document.querySelector('[data-page="play"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('can open full help with onboarding and real help text', async () => {
    const app = await loadApp();

    click('#help-mode-btn');

    expect(app.textContent).toContain('Use it like a sidecar scorekeeper');
    expect(app.textContent).toContain('Full help');
    expect(app.textContent).toContain('Compact board');
    expect(app.textContent).toContain('Guided turn mode');
    expect(app.textContent).toContain('Next step: enter the roll');
    expect(app.textContent).toContain('Choose a dice total');
    expect(app.textContent).toContain('Bright tiles are still up');
    expect(app.textContent).toContain('All up');
    expect(app.textContent).toContain('Demo turn');
    expect(document.querySelectorAll('.help-tag').length).toBeGreaterThanOrEqual(6);
    expect(document.querySelector('.help-tag')?.getAttribute('data-tip')).toContain(
      'current board',
    );
    expect(document.querySelector('[data-page="play"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('toggles and persists compact returning-player mode', async () => {
    let app = await loadApp();

    click('#help-mode-btn');
    expect(document.querySelector('#help-mode-btn')?.textContent).toContain('Hide help');
    click('#help-mode-btn');

    expect(app.textContent).toContain('Game view on');
    expect(app.textContent).toContain('Show help');
    expect(app.textContent).not.toContain('Use it like a sidecar scorekeeper');
    expect(app.textContent).not.toContain('Guided turn mode');
    expect(app.textContent).not.toContain('State analysis');
    expect(app.textContent).not.toContain('Dice odds');
    expect(document.querySelector('.app-layout')?.className).toContain('is-compact');
    expect(document.querySelector('.play-primer')).toBeNull();
    expect(document.querySelector('.summary-panel')).toBeNull();

    click('[data-roll="7"]');
    expect(document.querySelector('.why-panel')?.hasAttribute('open')).toBe(false);

    app = await loadApp();
    expect(app.textContent).toContain('Tiles still up');
    expect(app.textContent).not.toContain('Use it like a sidecar scorekeeper');

    click('#help-mode-btn');
    expect(app.textContent).toContain('Guidance restored');
    expect(app.textContent).toContain('Use it like a sidecar scorekeeper');

    click('[data-help-mode="compact"]');
    expect(app.textContent).toContain('Game view on');
  });

  it('ranks moves after a roll and applies the best move', async () => {
    const app = await loadApp();

    click('[data-roll="7"]');

    expect(app.textContent).toContain('Close 7');
    expect(app.textContent).toContain('Why this move?');
    expect(app.textContent).toContain('The next alternative');
    expect(app.textContent).toContain('Close these tiles');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-optimal');

    click('[data-move-mask]');

    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-closed');
    expect(app.textContent).toContain('Closed 7. Roll cleared. Next: roll again.');
    expect(app.textContent).toContain('What did you roll?');
  });

  it('supports tile editing, typed dice totals, objective changes, and no-move states', async () => {
    const app = await loadApp();

    click('[data-tile="1"]');
    click('[data-tile="2"]');
    click('[data-tile="3"]');
    inputValue('#dice-input', '2');

    expect(app.textContent).toContain('No legal move');
    expect(app.textContent).toContain('Final score: 39');

    click('#help-mode-btn');
    click('[data-objective="maximize_shutting"]');
    expect(app.textContent).toContain('Shut chance');
    expect(document.querySelector('[data-objective="maximize_shutting"]')?.className).toContain(
      'is-active',
    );
  });

  it('lets two-digit dice totals be typed without clearing the first digit', async () => {
    const app = await loadApp();

    inputValue('#dice-input', '1');

    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('1');
    expect(app.textContent).toContain('Waiting for roll');

    inputValue('#dice-input', '10');

    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('10');
    expect(app.textContent).toContain('Close 1 + 9');

    inputValue('#dice-input', '');

    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('');
    expect(app.textContent).toContain('Roll cleared.');
  });

  it('auto-suggests one die when eligible and keeps random roll controls in range', async () => {
    const app = await loadApp();

    click('[data-tile="7"]');
    click('[data-tile="8"]');
    click('[data-tile="9"]');

    expect(app.textContent).toContain('Auto: 1 die suggested');
    expect(app.textContent).toContain('One die is available. Auto selected 1d6');
    expect(app.textContent).toContain('1d6 total');
    expect(document.querySelector('[data-roll="1"]')).not.toBeNull();
    expect(document.querySelector('[data-roll="12"]')).toBeNull();

    click('#random-roll-btn');

    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('3');
    expect(app.textContent).toContain('Clear');

    click('#clear-roll-btn');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('');
  });

  it('supports board shortcuts plus undo and redo', async () => {
    const app = await loadApp();

    click('#clear-high-btn');
    expect(app.textContent).toContain('Marked 7 + 8 + 9 down. One die is now available.');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-closed');
    expect(app.textContent).toContain('One die is available. Auto selected 1d6');
    expect(document.querySelector<HTMLButtonElement>('#undo-btn')?.disabled).toBe(false);

    click('#undo-btn');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-open');
    expect(document.querySelector<HTMLButtonElement>('#redo-btn')?.disabled).toBe(false);

    click('#redo-btn');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-closed');

    click('#all-open-btn');
    expect(app.textContent).toContain('All tiles set up');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-open');
  });

  it('loads a practice demo turn', async () => {
    const app = await loadApp();

    click('#demo-turn-btn');

    expect(app.textContent).toContain('Demo loaded');
    expect(app.textContent).toContain('Close 7');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('7');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-optimal');
  });

  it('supports keyboard shortcuts for roll, apply, random roll, undo, and redo', async () => {
    const app = await loadApp();

    pressKey('7');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('7');
    expect(app.textContent).toContain('Close 7');

    pressKey('Enter');
    expect(app.textContent).toContain('Closed 7. Roll cleared. Next: roll again.');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-closed');

    pressKey('u');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-open');

    pressKey('y');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-closed');

    pressKey('r');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('6');
  });

  it('ignores keyboard shortcuts while typing in the dice input', async () => {
    const app = await loadApp();

    pressKeyOn('#dice-input', '7');

    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('');
    expect(app.textContent).toContain('Waiting for roll');
  });

  it('persists board, roll, objective, and dice mode locally', async () => {
    let app = await loadApp();

    click('[data-tile="7"]');
    click('[data-tile="8"]');
    click('[data-tile="9"]');
    click('[data-dice-mode="one"]');
    click('#help-mode-btn');
    click('[data-objective="maximize_survival"]');
    click('[data-roll="4"]');

    app = await loadApp();

    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-closed');
    expect(app.textContent).toContain('Manual: 1 die');
    expect(app.textContent).toContain('Survival');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('4');
  });

  it('falls back cleanly when persisted state is corrupt', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-json');

    const app = await loadApp();

    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-open');
    expect(app.textContent).toContain('Auto: 2 dice');
  });

  it('allows manual dice mode overrides when one die is legal', async () => {
    const app = await loadApp();

    expect(document.querySelector<HTMLButtonElement>('[data-dice-mode="one"]')?.disabled).toBe(
      true,
    );

    click('[data-tile="7"]');
    click('[data-tile="8"]');
    click('[data-tile="9"]');

    expect(document.querySelector<HTMLButtonElement>('[data-dice-mode="one"]')?.disabled).toBe(
      false,
    );

    click('[data-dice-mode="two"]');
    expect(app.textContent).toContain('Manual: 2 dice');
    expect(app.textContent).toContain('2d6 total');
    expect(document.querySelector('[data-roll="12"]')).not.toBeNull();

    click('[data-dice-mode="one"]');
    expect(app.textContent).toContain('Manual: 1 die');
    expect(app.textContent).toContain('1d6 total');
    expect(document.querySelector('[data-roll="12"]')).toBeNull();
  });

  it('generates two-dice random rolls before one-die eligibility', async () => {
    await loadApp();

    click('#random-roll-btn');

    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('6');
    expect(document.body.textContent).toContain('Close 6');
  });

  it('renders the shut-box win state', async () => {
    const app = await loadApp();

    for (let tile = 1; tile <= 9; tile++) {
      click('[data-tile="' + tile + '"]');
    }

    expect(app.textContent).toContain('Box shut');
    expect(app.textContent).toContain('Final score: 0');
    expect(app.textContent).toContain('Shut');

    click('#help-mode-btn');
    expect(app.textContent).toContain('Next step: start a new game');
  });

  it('resets all mutable play state', async () => {
    const app = await loadApp();

    click('[data-tile="9"]');
    click('#help-mode-btn');
    click('[data-objective="maximize_survival"]');
    click('[data-dice-mode="two"]');
    click('[data-roll="7"]');
    click('#reset-btn');

    expect(document.querySelector('[data-tile="9"]')?.className).toContain('is-open');
    expect(app.textContent).toContain('Auto: 2 dice');
    expect(document.querySelector('[data-dice-mode="auto"]')?.className).toContain('is-active');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('');
    expect(document.querySelector('.app-layout')?.className).toContain('is-compact');

    click('#help-mode-btn');
    expect(app.textContent).toContain('Lowest score');
  });

  it('routes to the guide page by direct URL and in-app navigation', async () => {
    let app = await loadApp('/how-to-use');

    expect(app.textContent).toContain('How to use the advisor without guessing');
    expect(app.textContent).toContain('30-second flow');
    expect(window.location.pathname).toBe(BASE_PATH + '/how-to-use');

    click('[data-page="math"]');
    app = document.getElementById('app')!;

    expect(window.location.pathname).toBe(BASE_PATH + '/math');
    expect(app.textContent).toContain('Optimal Shut the Box as dynamic programming');
  });

  it('renders the simulator route and navigates to it', async () => {
    let app = await loadApp('/simulator');

    expect(app.textContent).toContain('3D Shut the Box simulator');
    expect(app.textContent).toContain('Live stats');
    expect(app.textContent).toContain('Roll turn');
    expect(app.textContent).toContain('Ready: roll the dice');
    expect(document.querySelector('#sim-canvas')).not.toBeNull();
    expect(window.location.pathname).toBe(BASE_PATH + '/simulator');

    click('[data-page="play"]');
    expect(window.location.pathname).toBe(BASE_PATH + '/');

    click('[data-page="simulator"]');
    app = document.getElementById('app')!;

    expect(app.textContent).toContain('3D Shut the Box simulator');
    expect(window.location.pathname).toBe(BASE_PATH + '/simulator');
  });

  it('runs a simulator turn, applies the engine move, and resets', async () => {
    vi.useFakeTimers();
    const app = await loadApp('/simulator');

    click('#sim-roll-btn');

    expect(app.textContent).toContain('Dice in motion');
    expect(app.textContent).toContain('Turn 1: rolled 6 with two dice.');

    vi.advanceTimersByTime(1000);

    expect(app.textContent).toContain('Closed 6; score up is now 39.');
    expect(app.textContent).toContain('Score up39');

    click('#sim-reset-btn');

    expect(app.textContent).toContain('Reset: all tiles are standing.');
    expect(app.textContent).toContain('Score up45');
  });

  it('removes the second simulator die after tiles 7-9 close', async () => {
    vi.useFakeTimers();
    vi.mocked(Math.random)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.34)
      .mockReturnValueOnce(0.84)
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.99);
    const app = await loadApp('/simulator');

    click('#sim-roll-btn');
    vi.advanceTimersByTime(1000);
    click('#sim-roll-btn');
    vi.advanceTimersByTime(1000);
    click('#sim-roll-btn');
    vi.advanceTimersByTime(1000);

    expect(app.textContent).toContain('Tiles 7-9 are down; one die is now active.');
    expect(app.textContent).toContain('1 die active');
    expect(app.textContent).toContain('Dice1d6');
  });

  it('starts and pauses simulator auto-play', async () => {
    vi.useFakeTimers();
    const app = await loadApp('/simulator');

    click('#sim-auto-btn');
    expect(app.textContent).toContain('Pause auto');
    expect(app.textContent).toContain('Dice in motion');

    vi.advanceTimersByTime(1000);
    expect(app.textContent).toContain('Closed 6; score up is now 39.');

    click('#sim-auto-btn');
    expect(app.textContent).toContain('Auto-play');
  });

  it('supports direct math URLs and browser back navigation', async () => {
    const app = await loadApp('/math');

    expect(app.textContent).toContain('Bellman equations');
    expect(app.textContent).toContain('state s');
    expect(window.location.pathname).toBe(BASE_PATH + '/math');

    click('[data-page="play"]');
    expect(window.location.pathname).toBe(BASE_PATH + '/');
    expect(app.textContent).toContain('Tiles still up');

    window.history.pushState(null, '', BASE_PATH + '/math');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(app.textContent).toContain('Optimal Shut the Box as dynamic programming');
  });
});
