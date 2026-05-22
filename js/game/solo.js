// Single-player ("solo CEO") game state + rules engine.
//
// Original implementation inspired by HF4's CEO Solitaire variant
// without reproducing its rules text. Player runs one ship over a
// limited budget of water (delta-v), races a round clock, and
// scores VP by prospecting claimable sites. Persisted to
// localStorage so the game survives a refresh.
//
// State shape:
//   {
//     ship: { at: string },          // current site id
//     water: number,                  // remaining fuel budget
//     turn: number,                   // ops used this round
//     round: number,                  // current round (1..MAX_ROUNDS)
//     claimed: [string],              // site ids successfully prospected
//     score: number,                  // cumulative VPs
//     log: [string],                  // newest first
//     pendingTargetId: string | null, // proposed destination
//     pendingPath: { totalBurns, segments } | null,
//     gameOver: boolean,
//     startedAt: number,
//     finishedAt: number | null,
//   }

import { findPath } from './nav.js';

const STORAGE_KEY   = 'hf.solo';
const STARTING_WATER = 30;
const OPS_PER_ROUND  = 3;
const MAX_ROUNDS     = 30;
const TARGET_VP      = 20;

// Class -> minimum d6 roll required to prospect successfully. Soft
// scale so even the hardest sites are reachable but failure is
// likely without specialised equipment (Stage 3 territory).
const CLASS_THRESHOLD = { A: 3, B: 4, C: 5, D: 6 };

let _state = null;
let _data  = null;
const _listeners = new Set();

// ----- public surface -----

export function bindData(data) {
  _data = data;
  if (_state) emit();
}

export function getState() {
  if (_state) return _state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _state = raw ? JSON.parse(raw) : null;
  } catch { _state = null; }
  return _state;
}

export function onChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function newGame() {
  const startId = pickStartSiteId();
  _state = {
    ship: { at: startId },
    water: STARTING_WATER,
    turn: 0,
    round: 1,
    claimed: [],
    score: 0,
    log: ['Solo game begun -- 30 water, 30 rounds, target ' + TARGET_VP + ' VP.'],
    pendingTargetId: null,
    pendingPath: null,
    gameOver: false,
    startedAt: Date.now(),
    finishedAt: null,
  };
  persist();
  return _state;
}

export function abandonGame() {
  _state = null;
  persist();
}

// Set the proposed destination. The renderer can highlight it as
// the route; nothing actually changes on the ship yet.
export function setTarget(siteId) {
  if (!_state || _state.gameOver || !_data) return null;
  if (!siteId || siteId === _state.ship.at) {
    _state.pendingTargetId = null;
    _state.pendingPath = null;
    persist();
    return null;
  }
  const path = findPath(_data, _state.ship.at, siteId);
  if (!path) {
    _state.pendingTargetId = siteId;
    _state.pendingPath = null;
    persist();
    return null;
  }
  _state.pendingTargetId = siteId;
  _state.pendingPath = path;
  persist();
  return path;
}

// Commit the pending move: deduct water, move the ship, log it,
// and consume one operation of the round.
export function commitMove() {
  if (!_state || _state.gameOver) return false;
  if (!_state.pendingPath) return false;
  const cost = _state.pendingPath.totalBurns;
  if (cost > _state.water) {
    _state.log.unshift(`Move cancelled -- need ${cost} water, have ${_state.water}.`);
    persist();
    return false;
  }
  if (_state.turn >= OPS_PER_ROUND) {
    _state.log.unshift('No operations left this round. End the round first.');
    persist();
    return false;
  }
  const dest = _data.byId[_state.pendingTargetId];
  _state.water -= cost;
  _state.ship.at = _state.pendingTargetId;
  _state.pendingTargetId = null;
  _state.pendingPath = null;
  _state.turn += 1;
  _state.log.unshift(`Burned ${cost} water -> ${dest?.name || 'unknown site'}.`);
  persist();
  return true;
}

// Try to prospect the current site. Returns { ok, roll, threshold,
// vps?, reason? }.
export function prospect() {
  if (!_state || _state.gameOver) return { ok: false, reason: 'no_game' };
  if (_state.turn >= OPS_PER_ROUND) return { ok: false, reason: 'no_ops' };
  const here = _data?.byId[_state.ship.at];
  if (!here) return { ok: false, reason: 'no_site' };
  if (here.isWaypoint) return { ok: false, reason: 'not_claimable' };
  if (here.isLandable === false) return { ok: false, reason: 'not_landable' };
  if (_state.claimed.includes(here.id)) return { ok: false, reason: 'already' };

  const cls = (here.siteSize || '').match(/[A-D]/i)?.[0]?.toUpperCase() || 'A';
  const threshold = CLASS_THRESHOLD[cls] || 4;
  const roll = Math.floor(Math.random() * 6) + 1;
  _state.turn += 1;
  if (roll >= threshold) {
    const vps = 1 + (here.hydration | 0);
    _state.claimed.push(here.id);
    _state.score += vps;
    _state.log.unshift(`Prospected ${here.name}: rolled ${roll} vs ${threshold}. +${vps} VP.`);
    persist();
    return { ok: true, roll, threshold, vps };
  }
  _state.log.unshift(`Prospect failed at ${here.name}: rolled ${roll} vs ${threshold}.`);
  persist();
  return { ok: false, roll, threshold, reason: 'rolled_low' };
}

// End the round: collect water income from claimed hydrated sites,
// reset the per-round op counter, advance the round, and check
// for win/lose conditions.
export function endRound() {
  if (!_state || _state.gameOver) return;
  let income = 0;
  for (const id of _state.claimed) {
    const s = _data?.byId[id];
    if (s && s.hydration) income += s.hydration;
  }
  _state.water += income;
  _state.round += 1;
  _state.turn = 0;
  if (income) _state.log.unshift(`Round end -- +${income} water from refineries.`);
  if (_state.score >= TARGET_VP) {
    _state.gameOver = true;
    _state.finishedAt = Date.now();
    _state.log.unshift(`Victory: ${_state.score} VP in ${_state.round - 1} rounds.`);
  } else if (_state.round > MAX_ROUNDS) {
    _state.gameOver = true;
    _state.finishedAt = Date.now();
    _state.log.unshift(`Time's up. Final score: ${_state.score} VP.`);
  } else {
    _state.log.unshift(`Round ${_state.round} begins.`);
  }
  persist();
}

// ----- helpers -----

function pickStartSiteId() {
  if (!_data) return null;
  const earth = _data.sites.find((s) => s.name === 'Earth');
  if (earth) return earth.id;
  // Fall back to any inner-planet site so the player doesn't open
  // adrift in the outer system.
  const inner = _data.sites.find((s) => s.type === 'inner-planet' && !s.isWaypoint);
  return inner ? inner.id : (_data.sites[0]?.id || null);
}

function persist() {
  if (_state) localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  else localStorage.removeItem(STORAGE_KEY);
  emit();
}

function emit() {
  for (const fn of _listeners) {
    try { fn(_state); } catch (err) { console.error('solo listener', err); }
  }
}

export const SOLO_CONFIG = {
  STARTING_WATER, OPS_PER_ROUND, MAX_ROUNDS, TARGET_VP,
};
