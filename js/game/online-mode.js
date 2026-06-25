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
