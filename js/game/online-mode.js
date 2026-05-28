// Shared flag: are we driving the sandbox modules from a multiplayer
// server snapshot? When true, modules skip localStorage persistence so
// an online game never overwrites the solo sandbox save.
let _online = false;
export function isOnline() { return _online; }
export function setOnline(on) { _online = !!on; }
