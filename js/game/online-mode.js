import { homeLabelForSpecies, homeSiteIdForSpecies } from '../../data/sirens.js';

// Shared flag: are we driving the sandbox modules from a multiplayer
// server snapshot? When true, modules skip localStorage persistence so
// an online game never overwrites the solo sandbox save.
let _online = false;
export function isOnline() { return _online; }
export function setOnline(on) { _online = !!on; }

// Shared flag: is the M1 (Terawatt & Futures) module active in the
// current online game? Mirrors the server's state.m1 so client modules
// (rocket deploy gate, isotope fuel) can gate M1 affordances the same
// way the engine does. Always false in the frozen solo sandbox.
let _m1 = false;
export function isM1() { return _m1; }
export function setM1(on) { _m1 = !!on; }

// Shared flag: is the M2 (Futures) module active in the current online
// game? Mirrors the server's state.m2 so client modules can gate M2
// affordances the same way the engine does. Always false in the frozen
// solo sandbox.
let _m2 = false;
export function isM2() { return _m2; }
export function setM2(on) { _m2 = !!on; }

// Shared flag: is SIRENS mode (V9) active in the current online game? Players
// are Sirenian factions homed at Cordelia rather than LEO. Mirrors the server's
// state.sirens so client affordances gate exactly the way the engine does.
// Independent of M0/M1/M2 - it neither forces nor is forced by any of them,
// though a room cannot pick it alongside M0. Always false in the frozen solo
// sandbox.
let _sirens = false;
export function isSirens() { return _sirens; }
export function setSirens(on) { _sirens = !!on; }

// MY species in a Sirens game ('siren' | 'earthling'), or null everywhere else.
// It decides where my home base is, and therefore what a dozen bits of UI copy
// should say instead of "LEO": the home stack tab, the boost destination, the
// hand hint. Set from the snapshot alongside setSirens; stays null in every
// non-Sirens game, so `homeLabel()` keeps returning 'LEO' by construction.
let _species = null;
export function mySpecies() { return _species; }
export function setMySpecies(s) { _species = (s === 'siren' || s === 'earthling') ? s : null; }
export function isMySiren() { return _species === 'siren'; }
// The display name of MY home base. 'LEO' for everyone who is not a Siren.
export function homeLabel() { return homeLabelForSpecies(_species); }
// The SERVER slug of my home base, or null for LEO (which has no site row).
export function homeSiteId() { return homeSiteIdForSpecies(_species); }

// Shared flag: is the Futures LAYER active? Futures are the long game (rule 1D
// d): only a 7-round M2 room runs them, so a short M2 game (5-6 rounds) has
// colonization but no Futures. Mirrors the server's state.futures; every
// futures-only client affordance (missions tracker, card future link) gates on
// this, not isM2().
let _futures = false;
export function isFutures() { return _futures; }
export function setFutures(on) { _futures = !!on; }
