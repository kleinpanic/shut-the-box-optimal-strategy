import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE_PATH = '/shut-the-box-optimal-strategy';

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

describe('strategy app shell', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the play page with clear onboarding and real help text', async () => {
    const app = await loadApp();

    expect(app.textContent).toContain('Use it like a sidecar scorekeeper');
    expect(app.textContent).toContain('Choose a dice total');
    expect(app.textContent).toContain('Bright tiles are open');
    expect(document.querySelectorAll('.help-tag').length).toBeGreaterThanOrEqual(6);
    expect(document.querySelector('.help-tag')?.getAttribute('data-tip')).toContain(
      'current board',
    );
    expect(document.querySelector('[data-page="play"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('ranks moves after a roll and applies the best move', async () => {
    const app = await loadApp();

    click('[data-roll="7"]');

    expect(app.textContent).toContain('Close 7');
    expect(app.textContent).toContain('Apply best');
    expect(document.querySelector('[data-tile="7"]')?.className).toContain('is-optimal');

    click('[data-move-mask]');

    expect(app.textContent).toContain('Open tiles: 1, 2, 3, 4, 5, 6, 8, 9');
    expect(app.textContent).toContain('Choose a dice total');
  });

  it('supports tile editing, typed dice totals, objective changes, and no-move states', async () => {
    const app = await loadApp();

    click('[data-tile="1"]');
    click('[data-tile="2"]');
    click('[data-tile="3"]');
    inputValue('#dice-input', '2');

    expect(app.textContent).toContain('No legal move');
    expect(app.textContent).toContain('Final score: 39');

    click('[data-objective="maximize_shutting"]');
    expect(app.textContent).toContain('Shut chance');
    expect(document.querySelector('[data-objective="maximize_shutting"]')?.className).toContain(
      'is-active',
    );
  });

  it('auto-suggests one die when eligible and keeps random roll controls in range', async () => {
    const app = await loadApp();

    click('[data-tile="7"]');
    click('[data-tile="8"]');
    click('[data-tile="9"]');

    expect(app.textContent).toContain('Auto: 1 die suggested');
    expect(app.textContent).toContain('1d6 total');
    expect(document.querySelector('[data-roll="1"]')).not.toBeNull();
    expect(document.querySelector('[data-roll="12"]')).toBeNull();

    click('#random-roll-btn');

    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('3');
    expect(app.textContent).toContain('Clear');

    click('#clear-roll-btn');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('');
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
  });

  it('resets all mutable play state', async () => {
    const app = await loadApp();

    click('[data-tile="9"]');
    click('[data-objective="maximize_survival"]');
    click('[data-dice-mode="two"]');
    click('[data-roll="7"]');
    click('#reset-btn');

    expect(app.textContent).toContain('Open tiles: 1, 2, 3, 4, 5, 6, 7, 8, 9');
    expect(app.textContent).toContain('Lowest score');
    expect(app.textContent).toContain('Auto: 2 dice');
    expect(document.querySelector('[data-dice-mode="auto"]')?.className).toContain('is-active');
    expect(document.querySelector<HTMLInputElement>('#dice-input')?.value).toBe('');
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

  it('supports direct math URLs and browser back navigation', async () => {
    const app = await loadApp('/math');

    expect(app.textContent).toContain('Bellman equations');
    expect(app.textContent).toContain('state s');
    expect(window.location.pathname).toBe(BASE_PATH + '/math');

    click('[data-page="play"]');
    expect(window.location.pathname).toBe(BASE_PATH + '/');
    expect(app.textContent).toContain('Use it like a sidecar scorekeeper');

    window.history.pushState(null, '', BASE_PATH + '/math');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(app.textContent).toContain('Optimal Shut the Box as dynamic programming');
  });
});
