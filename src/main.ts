import './style.css';
import { getRankedMoves, tileValue, diceDistribution } from './engine/index.js';
import { TWO_DICE_DP, ONE_DICE_DP } from './engine/dp.js';
import type { Objective, RankedMove } from './engine/types.js';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
interface AppState {
  gameState: number; // bitmask: bit i = tile (i+1) open
  roll: number | null;
  objective: Objective;
  useOneDie: boolean;
}

const FULL_STATE = 0x1ff;

const state: AppState = {
  gameState: FULL_STATE,
  roll: null,
  objective: 'minimize_score',
  useOneDie: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function canUseOneDie(gs: number): boolean {
  return (gs & 0x1c0) === 0; // tiles 7,8,9 all closed
}

function activeOneDie(): boolean {
  return state.useOneDie && canUseOneDie(state.gameState);
}

function scoreColor(score: number): string {
  if (score === 0) return '#34d399';
  if (score <= 10) return '#60a5fa';
  if (score <= 25) return '#fbbf24';
  return '#f87171';
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render(): void {
  document.getElementById('app')!.innerHTML = buildApp();
  attach();
}

function buildApp(): string {
  return `
    <div style="min-height:100vh;background:#030712">
      ${header()}
      <main style="max-width:1280px;margin:0 auto;padding:16px;display:grid;grid-template-columns:1fr;gap:16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;align-items:start">
          <div style="display:flex;flex-direction:column;gap:16px">
            ${controlsPanel()}
            ${statsPanel()}
          </div>
          <div style="display:flex;flex-direction:column;gap:16px;flex:2">
            ${tileGrid()}
            ${dicePanel()}
            ${moveAdvisor()}
          </div>
          <div style="display:flex;flex-direction:column;gap:16px">
            ${chartPanel()}
          </div>
        </div>
      </main>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function header(): string {
  const score = tileValue(state.gameState);
  const col = scoreColor(score);
  return `
    <header style="background:#0a0e1a;border-bottom:1px solid #1f2937;position:sticky;top:0;z-index:10;padding:12px 20px">
      <div style="max-width:1280px;margin:0 auto;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:36px;height:36px;background:linear-gradient(135deg,#10b981,#059669);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold">□</div>
          <div>
            <div style="font-size:18px;font-weight:700;color:#f9fafb;line-height:1.2">Shut the Box</div>
            <div style="font-size:11px;color:#6b7280;letter-spacing:.05em">OPTIMAL STRATEGY ASSISTANT</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:right">
            <div style="font-size:11px;color:#6b7280">OPEN TILES SCORE</div>
            <div style="font-size:28px;font-weight:800;color:${col};line-height:1;transition:color 0.3s">${score}</div>
          </div>
          <button id="reset-btn" style="padding:8px 16px;background:#1f2937;border:1px solid #374151;border-radius:8px;color:#d1d5db;font-size:13px;cursor:pointer;transition:background 0.2s">
            🔄 New Game
          </button>
        </div>
      </div>
    </header>
  `;
}

// ---------------------------------------------------------------------------
// Controls panel
// ---------------------------------------------------------------------------
function controlsPanel(): string {
  const eligible = canUseOneDie(state.gameState);
  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em;margin-bottom:12px">STRATEGY OBJECTIVE</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${objectiveBtn('minimize_score', '↓', 'Min Expected Score', 'Minimize your final tile sum')}
        ${objectiveBtn('maximize_shutting', '🎯', 'Max Shut Probability', 'Maximize chance of winning')}
        ${objectiveBtn('maximize_survival', '🛡', 'Max Survivability', 'Maximize chance of next move')}
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid #1e293b">
        <label style="display:flex;align-items:center;justify-content:space-between;cursor:${eligible ? 'pointer' : 'not-allowed'};opacity:${eligible ? 1 : 0.45}">
          <div>
            <div style="font-size:13px;color:#e2e8f0;font-weight:500">One-Die Mode</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${eligible ? 'Tiles 7–9 closed — eligible' : 'Close tiles 7–9 to unlock'}</div>
          </div>
          <div style="position:relative;width:44px;height:24px">
            <input type="checkbox" id="one-die-toggle" ${state.useOneDie && eligible ? 'checked' : ''} ${!eligible ? 'disabled' : ''}
              style="position:absolute;opacity:0;width:100%;height:100%;cursor:${eligible ? 'pointer' : 'not-allowed'};z-index:1;margin:0">
            <div style="position:absolute;inset:0;border-radius:12px;background:${state.useOneDie && eligible ? '#10b981' : '#374151'};transition:background 0.2s"></div>
            <div style="position:absolute;top:3px;left:${state.useOneDie && eligible ? '23px' : '3px'};width:18px;height:18px;border-radius:50%;background:white;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
          </div>
        </label>
      </div>
    </div>
  `;
}

function objectiveBtn(obj: Objective, icon: string, label: string, desc: string): string {
  const active = state.objective === obj;
  const bg = active
    ? 'background:#134e34;border-color:#10b981'
    : 'background:#1e293b;border-color:transparent';
  const textCol = active ? '#6ee7b7' : '#94a3b8';
  const descCol = active ? '#34d399' : '#475569';
  return `
    <button data-objective="${obj}" style="width:100%;text-align:left;padding:10px 12px;border-radius:8px;border:1px solid;${bg};cursor:pointer;transition:all 0.15s">
      <div style="font-size:13px;font-weight:600;color:${textCol}">${icon} ${label}</div>
      <div style="font-size:11px;color:${descCol};margin-top:2px">${desc}</div>
    </button>
  `;
}

// ---------------------------------------------------------------------------
// Stats panel
// ---------------------------------------------------------------------------
function statsPanel(): string {
  const oneDie = activeOneDie();
  const dp = oneDie ? ONE_DICE_DP : TWO_DICE_DP;
  const gs = state.gameState;
  const score = tileValue(gs);

  const rows = [
    { label: 'Open tiles score', value: String(score), color: scoreColor(score) },
    {
      label: 'Expected final score',
      value: gs === 0 ? '0' : dp.expectedScore[gs].toFixed(2),
      color: '#60a5fa',
    },
    {
      label: 'P(shut box)',
      value: (dp.shutProbability[gs] * 100).toFixed(1) + '%',
      color: '#34d399',
    },
    {
      label: 'P(survive next roll)',
      value: (dp.survivalProbability[gs] * 100).toFixed(1) + '%',
      color: '#fbbf24',
    },
  ];

  const rowsHtml = rows
    .map(
      (r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;${i < rows.length - 1 ? 'border-bottom:1px solid #1e293b' : ''}">
      <span style="font-size:12px;color:#64748b">${r.label}</span>
      <span style="font-size:13px;font-weight:700;color:${r.color}">${r.value}</span>
    </div>
  `,
    )
    .join('');

  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em;margin-bottom:4px">STATE ANALYSIS</div>
      ${rowsHtml}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Tile grid
// ---------------------------------------------------------------------------
function tileGrid(): string {
  const ranked =
    state.roll !== null
      ? getRankedMoves(state.gameState, state.roll, state.objective, state.useOneDie)
      : [];
  const optimalMask = ranked.find((r) => r.isOptimal)?.move.mask ?? 0;

  const tiles = Array.from({ length: 9 }, (_, i) => {
    const t = i + 1;
    const bit = 1 << i;
    const isOpen = (state.gameState & bit) !== 0;
    const isInOptimal = (optimalMask & bit) !== 0;

    let bg: string;
    let border: string;
    let color: string;
    let extra = '';

    if (!isOpen) {
      bg = '#1a1f2e';
      border = '#2d3748';
      color = '#374151';
    } else if (isInOptimal) {
      bg = '#0a2e1f';
      border = '#10b981';
      color = '#6ee7b7';
      extra = 'class="tile-glow"';
    } else {
      bg = '#1e293b';
      border = '#334155';
      color = '#e2e8f0';
    }

    const content = isOpen ? String(t) : '✕';
    return `
      <button data-tile="${t}" ${extra}
        style="aspect-ratio:1;border-radius:10px;border:2px solid ${border};background:${bg};color:${color};
               font-size:clamp(18px,3vw,26px);font-weight:800;cursor:pointer;
               transition:all 0.15s;display:flex;align-items:center;justify-content:center;
               ${isOpen ? 'transform:scale(1)' : ''}">
        ${content}
      </button>
    `;
  }).join('');

  const isShut = state.gameState === 0;
  const isStuck = state.roll !== null && ranked.length === 0 && !isShut;

  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em">TILE BOARD</div>
        ${isShut ? '<div style="padding:4px 12px;background:#064e3b;border:1px solid #10b981;border-radius:20px;color:#34d399;font-size:12px;font-weight:700">🎉 BOX SHUT!</div>' : ''}
        ${isStuck ? '<div style="padding:4px 12px;background:#450a0a;border:1px solid #dc2626;border-radius:20px;color:#fca5a5;font-size:12px;font-weight:700">❌ No Valid Moves</div>' : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(9,1fr);gap:6px">
        ${tiles}
      </div>
      ${optimalMask !== 0 ? '<p style="font-size:11px;color:#34d399;text-align:center;margin-top:10px;margin-bottom:0;opacity:0.8">Glowing tiles = optimal move</p>' : ''}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Dice panel
// ---------------------------------------------------------------------------
function dicePanel(): string {
  const oneDie = activeOneDie();
  const minRoll = oneDie ? 1 : 2;
  const maxRoll = oneDie ? 6 : 12;

  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em;margin-bottom:12px">DICE ROLL</div>
      <div style="display:flex;gap:10px;align-items:center">
        <input type="number" id="dice-input" min="${minRoll}" max="${maxRoll}"
          value="${state.roll ?? ''}" placeholder="${oneDie ? '1–6' : '2–12'}"
          style="flex:1;background:#1e293b;border:1px solid #334155;border-radius:8px;
                 padding:12px 16px;color:#f9fafb;font-size:20px;font-weight:700;text-align:center;
                 outline:none;transition:border-color 0.2s">
        <button id="random-roll-btn"
          style="padding:12px 16px;background:#1e293b;border:1px solid #334155;border-radius:8px;
                 color:#d1d5db;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;
                 transition:background 0.2s">
          🎲 Roll Dice
        </button>
        ${state.roll !== null ? `<button id="clear-roll-btn" style="padding:12px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#6b7280;font-size:13px;cursor:pointer">✕</button>` : ''}
      </div>
      ${diceVisual()}
    </div>
  `;
}

function diceVisual(): string {
  if (state.roll === null) return '';
  const r = state.roll;
  const oneDie = activeOneDie();

  if (oneDie) {
    return `
      <div style="display:flex;justify-content:center;margin-top:14px">
        ${dieFace(r)}
        <div style="display:flex;align-items:center;margin-left:10px;font-size:20px;color:#64748b">= ${r}</div>
      </div>
    `;
  }

  // Show two dice summing to r (illustrative split)
  const d1 = Math.max(1, Math.min(6, Math.floor(r / 2)));
  const d2 = r - d1;
  return `
    <div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:14px">
      ${dieFace(d1)}
      <span style="color:#4b5563;font-size:18px;font-weight:bold">+</span>
      ${dieFace(d2)}
      <span style="color:#64748b;font-size:18px;font-weight:bold">= ${r}</span>
    </div>
  `;
}

function dieFace(n: number): string {
  return `
    <div style="width:52px;height:52px;background:white;border-radius:10px;display:flex;align-items:center;justify-content:center;
                font-size:24px;font-weight:900;color:#111827;box-shadow:0 4px 12px rgba(0,0,0,.4)">
      ${n}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Move advisor
// ---------------------------------------------------------------------------
function moveAdvisor(): string {
  if (state.roll === null) {
    return `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:32px;text-align:center;color:#4b5563">
        <div style="font-size:40px;margin-bottom:8px">🎲</div>
        <p style="font-size:14px;margin:0">Enter a dice roll above to see optimal moves</p>
      </div>
    `;
  }

  if (state.gameState === 0) {
    return `
      <div style="background:#022c22;border:1px solid #10b981;border-radius:12px;padding:32px;text-align:center">
        <div style="font-size:40px;margin-bottom:8px">🎉</div>
        <p style="font-size:18px;font-weight:700;color:#34d399;margin:0">Box is shut — you win!</p>
        <p style="font-size:13px;color:#6ee7b7;margin-top:6px">Click "New Game" to play again</p>
      </div>
    `;
  }

  const ranked = getRankedMoves(state.gameState, state.roll, state.objective, state.useOneDie);

  if (ranked.length === 0) {
    const score = tileValue(state.gameState);
    return `
      <div style="background:#2d0505;border:1px solid #dc2626;border-radius:12px;padding:32px;text-align:center">
        <div style="font-size:40px;margin-bottom:8px">❌</div>
        <p style="font-size:18px;font-weight:700;color:#f87171;margin:0">No valid moves</p>
        <p style="font-size:13px;color:#fca5a5;margin-top:6px">Game over — final score: <strong>${score}</strong></p>
      </div>
    `;
  }

  const objLabel: Record<Objective, string> = {
    minimize_score: 'Minimizing Expected Score',
    maximize_shutting: 'Maximizing Shut Probability',
    maximize_survival: 'Maximizing Survivability',
  };

  const cards = ranked.map((r, i) => moveCard(r, i)).join('');

  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em">MOVE ADVISOR</div>
        <span style="font-size:11px;color:#475569">${objLabel[state.objective]}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px" id="move-list">
        ${cards}
      </div>
    </div>
  `;
}

function moveCard(r: RankedMove, rank: number): string {
  const opt = r.isOptimal;
  const bg = opt
    ? 'background:#0a2e1f;border-color:#10b981'
    : 'background:#1a2235;border-color:#2d3748';
  const numBg = opt ? '#10b981' : '#374151';
  const numCol = opt ? 'white' : '#6b7280';
  const textCol = opt ? '#6ee7b7' : '#e2e8f0';
  const descCol = opt ? '#34d399' : '#64748b';
  const btnBg = opt ? '#059669' : '#374151';
  const btnHover = opt ? '#10b981' : '#4b5563';
  const tilesStr = r.move.tiles.join(' + ');

  return `
    <div class="move-card-enter" style="border-radius:10px;border:1px solid;${bg};padding:12px 14px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:26px;height:26px;border-radius:50%;background:${numBg};color:${numCol};font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${rank + 1}
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:14px;font-weight:700;color:${textCol}">Close ${tilesStr}</span>
            ${opt ? '<span style="font-size:10px;padding:2px 6px;background:#064e3b;color:#34d399;border-radius:4px;font-weight:700;letter-spacing:.04em">OPTIMAL</span>' : ''}
          </div>
          <div style="font-size:11px;color:${descCol};margin-top:3px">${r.explanation}</div>
        </div>
      </div>
      <button data-move-mask="${r.move.mask}"
        style="padding:7px 14px;background:${btnBg};border:none;border-radius:7px;color:${opt ? 'white' : '#d1d5db'};
               font-size:12px;font-weight:600;cursor:pointer;transition:background 0.15s;flex-shrink:0"
        onmouseover="this.style.background='${btnHover}'" onmouseout="this.style.background='${btnBg}'">
        Apply
      </button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Dice probability chart
// ---------------------------------------------------------------------------
function chartPanel(): string {
  const oneDie = activeOneDie();
  const dist = diceDistribution(oneDie);
  const entries = [...dist.entries()].sort((a, b) => a[0] - b[0]);
  const maxProb = Math.max(...dist.values());
  const roll = state.roll;

  const bars = entries
    .map(([rollVal, prob]) => {
      const heightPct = (prob / maxProb) * 100;
      const isActive = roll === rollVal;
      const barColor = isActive ? '#10b981' : '#1e3a5f';
      const textColor = isActive ? '#34d399' : '#475569';
      const pct = (prob * 100).toFixed(1);

      return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">
        <div style="font-size:9px;color:${textColor};font-weight:${isActive ? '700' : '400'}">${pct}%</div>
        <div style="flex:1;width:100%;display:flex;align-items:flex-end;min-height:80px">
          <div style="width:100%;height:${heightPct}%;background:${barColor};border-radius:3px 3px 0 0;transition:background 0.3s;min-height:3px"></div>
        </div>
        <div style="font-size:10px;color:${textColor};font-weight:${isActive ? '700' : '400'}">${rollVal}</div>
      </div>
    `;
    })
    .join('');

  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em;margin-bottom:12px">
        DICE DISTRIBUTION
        <span style="font-weight:400;color:#475569;margin-left:6px">${oneDie ? '1d6' : '2d6'}</span>
      </div>
      <div style="display:flex;gap:2px;align-items:flex-end;padding-bottom:4px">
        ${bars}
      </div>
      ${roll !== null ? `<div style="text-align:center;font-size:11px;color:#34d399;margin-top:8px">Roll ${roll} highlighted</div>` : ''}
    </div>
    ${riskDisplay()}
  `;
}

function riskDisplay(): string {
  const gs = state.gameState;
  if (gs === 0) return '';

  const oneDie = activeOneDie();
  const dp = oneDie ? ONE_DICE_DP : TWO_DICE_DP;
  const survival = dp.survivalProbability[gs];
  const shutP = dp.shutProbability[gs];

  const survivalPct = (survival * 100).toFixed(1);
  const shutPct = (shutP * 100).toFixed(1);

  const riskColor = survival > 0.8 ? '#34d399' : survival > 0.5 ? '#fbbf24' : '#f87171';
  const riskLabel = survival > 0.8 ? 'Low Risk' : survival > 0.5 ? 'Medium Risk' : 'High Risk';

  return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;margin-top:0">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.08em;margin-bottom:12px">RISK ANALYSIS</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:12px;color:#64748b">Survival probability</span>
            <span style="font-size:12px;font-weight:700;color:${riskColor}">${survivalPct}% — ${riskLabel}</span>
          </div>
          <div style="height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${survivalPct}%;background:${riskColor};border-radius:3px;transition:width 0.4s"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:12px;color:#64748b">Shut box probability</span>
            <span style="font-size:12px;font-weight:700;color:#60a5fa">${shutPct}%</span>
          </div>
          <div style="height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${shutPct}%;background:#60a5fa;border-radius:3px;transition:width 0.4s"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Event attachment
// ---------------------------------------------------------------------------
function attach(): void {
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    state.gameState = FULL_STATE;
    state.roll = null;
    state.useOneDie = false;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-objective]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.objective = btn.dataset.objective as Objective;
      render();
    });
  });

  const toggle = document.getElementById('one-die-toggle') as HTMLInputElement | null;
  toggle?.addEventListener('change', () => {
    state.useOneDie = toggle.checked;
    render();
  });

  const diceInput = document.getElementById('dice-input') as HTMLInputElement | null;
  diceInput?.addEventListener('input', () => {
    const v = parseInt(diceInput.value, 10);
    const oneDie = activeOneDie();
    const min = oneDie ? 1 : 2;
    const max = oneDie ? 6 : 12;
    if (!isNaN(v) && v >= min && v <= max) {
      state.roll = v;
      render();
    }
  });

  diceInput?.addEventListener('focus', () => {
    diceInput.style.borderColor = '#10b981';
  });
  diceInput?.addEventListener('blur', () => {
    diceInput.style.borderColor = '#334155';
  });

  document.getElementById('random-roll-btn')?.addEventListener('click', () => {
    const oneDie = activeOneDie();
    if (oneDie) {
      state.roll = Math.ceil(Math.random() * 6);
    } else {
      state.roll = Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
    }
    render();
  });

  document.getElementById('clear-roll-btn')?.addEventListener('click', () => {
    state.roll = null;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-tile]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = parseInt(btn.dataset.tile!, 10);
      const bit = 1 << (t - 1);
      state.gameState ^= bit;
      // Disable one-die mode if tiles 7-9 reopen
      if (!canUseOneDie(state.gameState)) state.useOneDie = false;
      state.roll = null;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-move-mask]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mask = parseInt(btn.dataset.moveMask!, 10);
      state.gameState = state.gameState & ~mask;
      if (!canUseOneDie(state.gameState)) state.useOneDie = false;
      state.roll = null;
      render();
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
render();
