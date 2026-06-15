// One-time repair: restore cards that an over-broad Solar Flare wrongly
// decommissioned off a rocket that was actually parked at a Site. Bunker
// Shielding makes cards on Sites immune to a flare, but an earlier engine bug
// swept at-site rockets and outposts anyway, sending their cards to the owner's
// hand. This script moves the named cards back from the player's hand onto the
// rocket stack and records a corrective entry in the game's log so every client
// re-hydrates cleanly.
//
// Run it ON the server box, where the live DB lives (the Fly volume):
//   fly ssh console -a high-frontier-fan-game \
//     -C "node /app/server/repair-flare-game.mjs gsdq11 ruben-phone"
//
// Defaults target the reported game / player / cards, but all are overridable:
//   node repair-flare-game.mjs <roomCode> [playerName] [cardName...]
//
// Idempotent: a card already on the rocket (not in hand) is skipped, so a
// second run is a no-op.

import { db } from './db.js';
import { PATENTS_BY_ID } from '../data/patents.js';

const code = (process.argv[2] || 'gsdq11').toLowerCase();
const playerName = process.argv[3] || 'ruben-phone';
const cardNames = process.argv.slice(4);
const defaultCardNames = ['Metallic Hydrogen', 'Atomic Layer Deposition'];
const wantNames = cardNames.length ? cardNames : defaultCardNames;

// Resolve a card NAME (white or black face, or the card label) to its id.
function idForName(name) {
  const want = String(name).trim().toLowerCase();
  for (const [id, c] of Object.entries(PATENTS_BY_ID)) {
    const labels = [
      c.name,
      c.faces && c.faces.primary && c.faces.primary.name,
      c.faces && c.faces.secondary && c.faces.secondary.name,
    ].filter(Boolean).map((s) => s.toLowerCase());
    if (labels.includes(want)) return id;
  }
  return null;
}

const lobby = db.prepare('SELECT id, name FROM lobbies WHERE lower(code) = ?').get(code);
if (!lobby) { console.error(`No lobby with code "${code}".`); process.exit(1); }

const game = db
  .prepare("SELECT id, status FROM games WHERE lobby_id = ? ORDER BY created_at DESC LIMIT 1")
  .get(lobby.id);
if (!game) { console.error(`No game for lobby "${code}".`); process.exit(1); }

const stateRow = db.prepare('SELECT state, seq FROM game_states WHERE game_id = ?').get(game.id);
if (!stateRow) { console.error('No game state row.'); process.exit(1); }

const state = JSON.parse(stateRow.state);
const player = (state.players || []).find(
  (p) => String(p.name).toLowerCase() === playerName.toLowerCase()
);
if (!player) {
  console.error(`No player "${playerName}". Players: ${(state.players || []).map((p) => p.name).join(', ')}`);
  process.exit(1);
}
player.rocket = player.rocket || {};
player.rocket.stack = player.rocket.stack || [];
player.hand = player.hand || [];

const restored = [];
const skipped = [];
for (const name of wantNames) {
  const id = idForName(name);
  if (!id) { console.warn(`! Unknown card name "${name}", skipping.`); continue; }
  if (player.rocket.stack.some((s) => s.id === id)) { skipped.push(name); continue; }
  const idx = player.hand.indexOf(id);
  if (idx < 0) {
    console.warn(`! "${name}" (${id}) is not in ${player.name}'s hand, skipping.`);
    continue;
  }
  player.hand.splice(idx, 1);
  player.rocket.stack.push({ id, kind: 'patent' });
  restored.push(name);
}

if (!restored.length) {
  console.log(`Nothing to restore (already on the rocket: ${skipped.join(', ') || 'none'}). No write.`);
  process.exit(0);
}

const nextSeq = stateRow.seq + 1;
const now = Date.now();
const stateJson = JSON.stringify(state);
const log = `Correction: ${restored.join(' and ')} restored aboard ${player.name}'s rocket `
  + '(a Solar Flare wrongly hit a stack that was shielded on a Site).';

db.transaction(() => {
  db.prepare('UPDATE game_states SET state = ?, seq = ?, updated_at = ? WHERE game_id = ?')
    .run(stateJson, nextSeq, now, game.id);
  db.prepare(
    `INSERT INTO game_operations (game_id, seq, profile_id, kind, payload, log, state_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(game.id, nextSeq, player.profileId, 'ADMIN_REPAIR', '{}', log, stateJson, now);
})();

console.log(`OK. ${log}`);
console.log(`Game ${game.id} (lobby "${lobby.name}", ${code}) -> seq ${nextSeq}.`);
if (skipped.length) console.log(`Already aboard (left as-is): ${skipped.join(', ')}.`);
