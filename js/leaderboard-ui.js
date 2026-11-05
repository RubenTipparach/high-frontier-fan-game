// Leaderboards modal (menu > View > Leaderboards). Every board the server ranks
// (server/leaderboard.js), in a Multiplayer and a Solo section: one board per
// module set (Modules 0 + 1 + 2, Modules 0 + 1, ...) plus The Sirens, Hermes
// Fall, Altruism and CEO Solitaire. Each row is a
// player's best single-game VP on that board, with their wins and games.

import { getLeaderboards } from './api.js';
import { loadProfile } from './storage.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const GROUP_ORDER = ['Multiplayer', 'Solo'];
let _lastBoard = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function openLeaderboards() {
  document.querySelector('.lb-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay lb-overlay';
  overlay.innerHTML = `
    <div class="lb-panel" role="dialog" aria-modal="true" aria-labelledby="lb-title">
      <div class="lb-head">
        <h2 id="lb-title">🏆 Leaderboards</h2>
        <button type="button" class="modal-x lb-close" aria-label="Close" title="Close (Esc)">×</button>
      </div>
      <p class="lb-sub">Each player's best single-game score on every board. Ties go to more wins.</p>
      <div class="lb-tabs" role="tablist"></div>
      <div class="lb-body"><p class="lb-empty">Loading the boards…</p></div>
    </div>`;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.lb-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  const r = await getLeaderboards();
  const body = overlay.querySelector('.lb-body');
  if (!r || !r.ok) {
    body.innerHTML = '<p class="lb-empty">The leaderboards are unavailable right now.</p>';
    return;
  }
  const boards = (r.data && r.data.boards) || [];
  if (!boards.length) {
    body.innerHTML = '<p class="lb-empty">No finished games on the boards yet. Finish one to take the top spot.</p>';
    return;
  }
  const me = (loadProfile() || {}).id;
  const tabs = overlay.querySelector('.lb-tabs');
  const show = (key) => {
    const b = boards.find((x) => x.key === key) || boards[0];
    _lastBoard = b.key;
    tabs.querySelectorAll('.lb-tab').forEach((t) => {
      const on = t.dataset.key === b.key;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    body.innerHTML = renderBoard(b, me);
  };
  for (const group of GROUP_ORDER) {
    const inGroup = boards.filter((b) => b.group === group);
    if (!inGroup.length) continue;
    const row = document.createElement('div');
    row.className = 'lb-tab-row';
    row.innerHTML = `<span class="lb-group">${esc(group)}</span>`;
    for (const b of inGroup) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'lb-tab';
      t.dataset.key = b.key;
      t.setAttribute('role', 'tab');
      t.textContent = `${b.emoji} ${b.name}`;
      t.addEventListener('click', () => show(b.key));
      row.appendChild(t);
    }
    tabs.appendChild(row);
  }
  show(_lastBoard && boards.some((b) => b.key === _lastBoard) ? _lastBoard : boards[0].key);
}

function renderBoard(b, me) {
  const rows = b.entries.map((e) => {
    const place = MEDALS[e.rank - 1] || `<span class="lb-num">${e.rank}</span>`;
    const record = b.showsWins
      ? `<span class="lb-wins">${plural(e.wins, 'win')}</span> <span class="lb-dim">in ${plural(e.games, 'game')}</span>`
      : `<span class="lb-dim">${plural(e.games, 'game')}</span>`;
    return `<tr class="${e.rank <= 3 ? 'lb-podium' : ''}${String(e.profileId) === String(me) ? ' lb-me' : ''}">
      <td class="lb-place">${place}</td>
      <td class="lb-name">@${esc(e.name)}</td>
      <td class="lb-vp"><b>${e.best}</b> VP</td>
      <td class="lb-record">${record}</td>
    </tr>`;
  }).join('');
  return `
    <div class="lb-board-title">${esc(b.emoji)} ${esc(b.group)} · ${esc(b.name)}
      <span class="lb-dim">${plural(b.players, 'player')} ranked</span></div>
    <table class="lb-table"><tbody>${rows}</tbody></table>`;
}
