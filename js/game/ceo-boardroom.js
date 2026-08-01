// CEO Solitaire - Board Meeting screen.
//
// Shown at a Board Meeting (and reused at game end): the company Board sits
// around a circular table and decides whether you remain CEO. Three beats:
//   1. The table  - a hand-authored SVG of board members seated around a round
//      table, the CEO chair highlighted.
//   2. The verdict - a stamped reveal of "Expectations met" vs "Below
//      expectations" against this cycle's KPI.
//   3. The record - a small income (aqua) vs score (VP) chart over the cycles
//      so far, so the player sees the trajectory the Board is judging.
//
// Player-facing copy is about the GAME (the Board, the program, the number),
// never the engine (Style rule). Built on the .card-modal-overlay pattern.
//
// CEO Solitaire is RELEASED (v1.2.0). The V6 board-meeting engine feeds this
// screen its real per-cycle numbers (verdict / kpi / history via the callers);
// the preview harness can still stage it with demo data.

import { firedSvg, promotedSvg } from './ceo-art.js';

const SEAT_COLORS = ['#7dd3fc', '#fbbf24', '#f87171', '#4ade80', '#c084fc', '#fb923c', '#38bdf8'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Build the SVG of the boardroom table. `members` board seats ring the top of a
// round table; the CEO seat sits at the bottom, highlighted gold. Pure SVG
// string so it renders identically in the app and the preview harness.
function boardTableSvg({ members = 6 } = {}) {
  const W = 520, H = 360;
  const cx = W / 2, cy = H / 2 + 6;
  const rx = 188, ry = 118;            // table ellipse radii
  const seatRx = rx + 36, seatRy = ry + 34;  // where the figures sit

  // Seat angles (degrees, 0 = right, measured clockwise from +x going down).
  // The CEO sits at the bottom (90deg). Board members ring the top half.
  const seats = [];
  const n = Math.max(3, Math.min(7, members));
  for (let k = 0; k < n; k++) {
    // Spread board members across the top arc, from ~200deg round to ~-20deg.
    const t = n === 1 ? 0.5 : k / (n - 1);
    const ang = 200 - t * 220;          // 200deg .. -20deg
    seats.push({ ang, color: SEAT_COLORS[k % SEAT_COLORS.length], role: 'member' });
  }
  // CEO seat at the bottom.
  const ceoSeat = { ang: 90, color: '#fbbf24', role: 'ceo' };

  const figure = (seat, idx) => {
    const rad = (seat.ang * Math.PI) / 180;
    const fx = cx + seatRx * Math.cos(rad);
    const fy = cy + seatRy * Math.sin(rad);
    const isCeo = seat.role === 'ceo';
    const r = isCeo ? 17 : 13;
    const bodyR = isCeo ? 30 : 23;
    const ring = isCeo
      ? `<circle cx="${fx.toFixed(1)}" cy="${(fy - 2).toFixed(1)}" r="${(bodyR + 9).toFixed(1)}" class="ceo-seat-ring"/>`
      : '';
    return `
      <g class="bm-figure ${isCeo ? 'is-ceo' : ''}" style="--seat:${seat.color}" data-seat="${idx}">
        ${ring}
        <path class="bm-body" d="M ${(fx - bodyR).toFixed(1)} ${(fy + bodyR * 0.95).toFixed(1)}
          a ${bodyR.toFixed(1)} ${(bodyR * 0.9).toFixed(1)} 0 0 1 ${(bodyR * 2).toFixed(1)} 0 Z"/>
        <circle class="bm-head" cx="${fx.toFixed(1)}" cy="${(fy - r * 0.5).toFixed(1)}" r="${r}"/>
      </g>`;
  };

  const figures = seats.map(figure).join('') + figure(ceoSeat, 'ceo');

  return `
  <svg class="bm-table-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="The Board seated around a round table">
    <defs>
      <radialGradient id="bm-table-grad" cx="50%" cy="42%" r="65%">
        <stop offset="0%" stop-color="#1a2438"/>
        <stop offset="70%" stop-color="#121a2c"/>
        <stop offset="100%" stop-color="#0c1120"/>
      </radialGradient>
      <radialGradient id="bm-spot" cx="50%" cy="38%" r="60%">
        <stop offset="0%" stop-color="rgba(251,191,36,0.16)"/>
        <stop offset="100%" stop-color="rgba(251,191,36,0)"/>
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bm-spot)"/>
    ${figures}
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#bm-table-grad)" stroke="#2a3650" stroke-width="2"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${(rx - 16).toFixed(1)}" ry="${(ry - 16).toFixed(1)}" fill="none" stroke="rgba(125,211,252,0.12)" stroke-width="1.5"/>
    <text x="${cx}" y="${(cy + 5).toFixed(1)}" class="bm-table-label" text-anchor="middle">BOARD OF DIRECTORS</text>
  </svg>`;
}

// Tiny income (aqua) vs score (VP) line chart over the cycles so far.
// history: [{ cycle, income, score }]. Pure SVG string.
function historyChartSvg(history = []) {
  const W = 460, H = 200, padL = 34, padR = 14, padT = 16, padB = 26;
  const pts = history.length ? history : [{ cycle: 1, income: 0, score: 0 }];
  const maxV = Math.max(4, ...pts.map((p) => Math.max(p.income | 0, p.score | 0)));
  const n = pts.length;
  const x = (k) => padL + (n === 1 ? (W - padL - padR) / 2 : (k / (n - 1)) * (W - padL - padR));
  const y = (v) => H - padB - (v / maxV) * (H - padT - padB);

  const line = (key, cls) => {
    const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'} ${x(k).toFixed(1)} ${y(p[key] | 0).toFixed(1)}`).join(' ');
    const dots = pts.map((p, k) => `<circle class="${cls}-dot" cx="${x(k).toFixed(1)}" cy="${y(p[key] | 0).toFixed(1)}" r="3"/>`).join('');
    return `<path class="${cls}-line" d="${d}" fill="none"/>${dots}`;
  };

  const gridY = [0, 0.5, 1].map((f) => {
    const v = Math.round(maxV * f);
    const yy = y(v);
    return `<line class="bm-grid" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>`
      + `<text class="bm-axis" x="${padL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
  }).join('');

  const xlabels = pts.map((p, k) => `<text class="bm-axis" x="${x(k).toFixed(1)}" y="${H - 8}" text-anchor="middle">C${p.cycle}</text>`).join('');

  return `
  <svg class="bm-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income versus score over the cycles">
    ${gridY}
    ${xlabels}
    ${line('income', 'bm-income')}
    ${line('score', 'bm-score')}
  </svg>`;
}

let _activeOverlay = null;

// Show the Board Meeting. Returns a promise resolving when dismissed.
//   cycle      - which Solar Cycle (1-based)
//   kpi        - the number the Board demands this cycle
//   score      - the player's accumulated VP (defaults to the steps' sum)
//   scoreSteps - [{ label, vp }] the tally lines, revealed one by one
//   verdict    - 'met' | 'missed' (forced); omit to derive from score vs kpi
//   members    - board member count (3-7)
//   history    - [{ cycle, income, score }] for the chart
//   isFinal    - last board meeting (changes the copy)
export function showBoardMeeting({
  cycle = 1, kpi = 0, score, scoreSteps = [], verdict, members = 6, history = [], isFinal = false, onDone,
} = {}) {
  if (_activeOverlay) { _activeOverlay.remove(); _activeOverlay = null; }
  const steps = Array.isArray(scoreSteps) ? scoreSteps.filter((s) => s && (s.vp | 0)) : [];
  const total = Number.isFinite(score) ? (score | 0) : steps.reduce((a, s) => a + (s.vp | 0), 0);
  const met = verdict ? verdict === 'met' : (total >= kpi);

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay ceo-boardroom-overlay';
  overlay.tabIndex = -1;
  _activeOverlay = overlay;

  const ratingBands = (s) => (s >= 60 ? 'Legendary' : s >= 40 ? 'Memorable' : s >= 35 ? 'Good' : s >= 30 ? 'Controversial' : '');
  const rating = met && isFinal ? ratingBands(total) : '';
  const outcomeText = met
    ? (isFinal
        ? `The Board is satisfied. Your tenure is judged <strong>${rating || 'a success'}</strong>.`
        : 'The Board is satisfied. You are promoted: more stock options, a bigger mandate, and your chair for another cycle.')
    : 'You fell short of the number. The Board has seen enough. You are fired.';

  // The tally rows (revealed one by one), then the demand line + running total.
  const stepRows = steps.map((s, k) => `
    <div class="bm-step" data-k="${k}">
      <span class="bm-step-label">${esc(s.label)}</span>
      <span class="bm-step-vp">+${s.vp | 0}</span>
    </div>`).join('');

  overlay.innerHTML = `
    <div class="bm-modal" role="dialog" aria-label="Board Meeting">
      <div class="bm-header">
        <h2 class="bm-h2">Board Meeting</h2>
        <p class="bm-sub">Solar Cycle ${cycle}${isFinal ? ' · final review' : ''} · the Board reviews the program</p>
      </div>
      <div class="bm-stage">
        ${boardTableSvg({ members })}
        <div class="bm-verdict ${met ? 'is-met' : 'is-missed'}" aria-live="polite">
          <div class="bm-stamp">${met ? 'EXPECTATIONS MET' : 'BELOW EXPECTATIONS'}</div>
        </div>
      </div>
      <div class="bm-tally">
        <div class="bm-tally-head">The tally</div>
        ${stepRows || '<div class="bm-step"><span class="bm-step-label">Victory points</span><span class="bm-step-vp">+' + total + '</span></div>'}
        <div class="bm-tally-foot">
          <div class="bm-kpi"><span class="bm-kpi-label">Board demands</span><span class="bm-kpi-val">${kpi} <small>VP</small></span></div>
          <div class="bm-kpi"><span class="bm-kpi-label">You delivered</span><span class="bm-kpi-val bm-running ${met ? 'good' : 'bad'}">0 <small>VP</small></span></div>
        </div>
      </div>
      <div class="bm-reveal" aria-live="polite"></div>
      <div class="bm-chart-wrap">
        <div class="bm-chart-legend">
          <span class="bm-leg bm-leg-income">Income (aqua)</span>
          <span class="bm-leg bm-leg-score">Score (VP)</span>
        </div>
        ${historyChartSvg(history)}
      </div>
      <div class="bm-actions">
        <button type="button" class="bm-continue primary" disabled>${met && !isFinal ? 'Back to work ▸' : 'Close'}</button>
      </div>
    </div>`;

  return new Promise((resolve) => {
    const timers = [];
    const finish = () => {
      document.removeEventListener('keydown', onKey);
      timers.forEach(clearTimeout);
      if (_activeOverlay === overlay) _activeOverlay = null;
      overlay.remove();
      if (typeof onDone === 'function') onDone();
      resolve(met);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.focus();

    const running = overlay.querySelector('.bm-running');
    const rows = [...overlay.querySelectorAll('.bm-step')];
    const cont = overlay.querySelector('.bm-continue');
    let acc = 0;
    // Reveal each tally row one by one, adding its VP into the running total.
    const stepList = steps.length ? steps : [{ vp: total }];
    rows.forEach((row, k) => {
      timers.push(setTimeout(() => {
        row.classList.add('is-in');
        acc += stepList[k] ? (stepList[k].vp | 0) : 0;
        if (running) running.firstChild.textContent = acc + ' ';
      }, 500 + k * 650));
    });
    // After the last row, settle the total, stamp the verdict, and reveal the
    // fired / promoted illustration.
    const afterSteps = 500 + rows.length * 650 + 400;
    timers.push(setTimeout(() => {
      if (running) running.firstChild.textContent = total + ' ';
      overlay.querySelector('.bm-verdict')?.classList.add('is-revealed');
      const reveal = overlay.querySelector('.bm-reveal');
      if (reveal) {
        reveal.innerHTML = `
          <figure class="bm-outcome-fig ${met ? 'is-good' : 'is-bad'}">
            ${met ? promotedSvg('bm-outcome-art') : firedSvg('bm-outcome-art')}
            <figcaption>${outcomeText}</figcaption>
          </figure>`;
        reveal.classList.add('is-in');
      }
      if (cont) cont.disabled = false;
    }, afterSteps));

    if (cont) cont.addEventListener('click', finish);
  });
}

// CEO Solitaire scoreboard, opened from the turn-bar "Scenario" button. Shows
// the KPI the next Board Meeting demands against the VP delivered so far, the
// per-category breakdown, and where the program stands in the cycle count. A
// footer button replays the intro slideshow. Pure read; no state changes.
//   live      { score, kpi, met, cyclesLeft, meetingsDone, steps }
//   rounds    total Solar Cycles in the program (for context)
//   onReplay  () => void  - play the intro slideshow again
//   replayLabel  button text for that footer button. Defaults to the replay
//     wording; a V9 Sirens solitaire room passes a "read this" label instead,
//     because there the CEO pitch never auto-played and "again" would be a lie.
export function showCeoScoreModal({ live, rounds, onReplay, replayLabel } = {}) {
  const l = live || {};
  const score = l.score | 0;
  const kpi = l.kpi | 0;
  const met = l.met != null ? !!l.met : (score >= kpi);
  const gap = score - kpi;
  const steps = Array.isArray(l.steps) ? l.steps.filter((s) => s && (s.vp | 0)) : [];
  const meetings = l.meetingsDone | 0;
  const total = rounds || (meetings + (l.cyclesLeft | 0));

  document.querySelector('.ceo-score-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay ceo-score-overlay';
  overlay.tabIndex = -1;

  const stepRows = steps.length
    ? steps.map((s) => `
        <div class="ceo-score-step">
          <span class="ceo-score-step-label">${esc(s.label)}</span>
          <span class="ceo-score-step-vp">+${s.vp | 0}</span>
        </div>`).join('')
    : '<div class="ceo-score-step ceo-score-step-empty"><span class="ceo-score-step-label">No victory points booked yet</span><span class="ceo-score-step-vp">0</span></div>';

  overlay.innerHTML = `
    <div class="ceo-score-modal" role="dialog" aria-label="CEO Solitaire scoreboard">
      <div class="modal-header">
        <h2 class="modal-title">👔 CEO Solitaire</h2>
        <button type="button" class="modal-x ceo-score-x" aria-label="Close">×</button>
      </div>
      <div class="ceo-score-body">
        <p class="ceo-score-lede">Deliver the number the Board is asking for by the next Board Meeting${total ? ` (meeting ${Math.min(meetings + 1, total)} of ${total})` : ''}.</p>
        <div class="ceo-score-cards">
          <div class="ceo-score-card ceo-score-target">
            <div class="ceo-score-card-label">Board demands</div>
            <div class="ceo-score-card-val">${kpi}<small>VP</small></div>
          </div>
          <div class="ceo-score-card ceo-score-current ${met ? 'is-good' : 'is-bad'}">
            <div class="ceo-score-card-label">You've delivered</div>
            <div class="ceo-score-card-val">${score}<small>VP</small></div>
          </div>
        </div>
        <div class="ceo-score-verdict ${met ? 'is-good' : 'is-bad'}">
          ${met
            ? `On track: <strong>+${gap}</strong> VP over the number.`
            : `Behind by <strong>${-gap}</strong> VP. Miss it at the meeting and you are fired.`}
        </div>
        <div class="ceo-score-breakdown">
          <div class="ceo-score-breakdown-head">Where your VP comes from</div>
          ${stepRows}
        </div>
      </div>
      <div class="card-modal-actions ceo-score-actions">
        <button type="button" class="modal-btn ceo-score-replay">${esc(replayLabel || '🎬 Play intro again')}</button>
        <button type="button" class="modal-btn primary ceo-score-close">Close</button>
      </div>
    </div>`;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.ceo-score-x')?.addEventListener('click', close);
  overlay.querySelector('.ceo-score-close')?.addEventListener('click', close);
  overlay.querySelector('.ceo-score-replay')?.addEventListener('click', () => {
    close();
    if (typeof onReplay === 'function') onReplay();
  });
  document.body.appendChild(overlay);
  overlay.focus();
}
