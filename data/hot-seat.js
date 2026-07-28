// Hot seat ("pass the device"): ONE account owns every seat at a table and
// plays them all in turn from a single browser, the way a group shares a laptop
// around a real table.
//
// The owner holds seat 1 as their REAL profile. The other seats are LOCAL seats
// carrying pseudo profile ids that have no `profiles` row - the same trick the
// guided tutorial already uses for its two scripted bots (server/game/tutorial.js
// TUTORIAL_BOT_IDS), so nothing downstream is surprised by a seat that is not an
// account. The difference is that nobody drives a hot seat automatically: the
// human at the keyboard plays it.
//
// The engine itself knows NOTHING about hot seat. It keeps validating "is this
// profileId the player the game is waiting on?" exactly as before; the ops route
// simply resolves which SEAT the owner is acting as before handing the engine a
// ctx.profileId. That keeps the whole feature to a lookup at the door instead of
// a special case in every op.
//
// Pure data + pure functions: imported by BOTH the browser client and the Node
// server, so no DOM and no `node:` imports (same contract as data/fuel-graph.js).

// Seat-count bounds. 6 is the colour palette's size (PLAYER_COLORS), which is
// also the real table maximum, so a hot-seat game can seat a full table.
export const MIN_HOT_SEATS = 2;
export const MAX_HOT_SEATS = 6;

// Pseudo profile ids for the local seats. Seat 1 is always the owner's real
// (numeric) profile id, so the generated ids start at seat 2.
const HOT_SEAT_ID_PREFIX = 'hot-seat-';

export function hotSeatId(seat) {
  return `${HOT_SEAT_ID_PREFIX}${seat}`;
}

// Is this profileId a LOCAL hot seat (as opposed to the owner's real account)?
// Ids are compared as strings because a real profileId is a number server-side
// but arrives as a string from some client reads.
export function isHotSeatId(profileId) {
  return typeof profileId === 'string' && profileId.startsWith(HOT_SEAT_ID_PREFIX);
}

// Default display name for a local seat. The crew draft gives each seat a real
// faction identity almost immediately, so this is only what the roster reads
// before anyone has picked.
export function hotSeatName(seat) {
  return `Seat ${seat}`;
}

// Clamp a requested seat count into the supported range. Anything unparseable
// falls back to the minimum, so a malformed request still starts a coherent game.
export function clampHotSeats(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return MIN_HOT_SEATS;
  return Math.max(MIN_HOT_SEATS, Math.min(MAX_HOT_SEATS, v));
}

// Same-id test that tolerates the number/string split above.
const sameId = (a, b) => String(a) === String(b);

// Does this caller own every seat at the table?
export function isHotSeatOwner(state, profileId) {
  return !!(state && state.hotSeat) && sameId(state.hotSeatOwnerId, profileId);
}

// The seat the table is WAITING ON right now, used as the fallback when the
// client does not name one. Ordered by which gate would actually reject an op:
// a pending chooser (seniority disc / first-player handoff) freezes the table
// for one specific seat, an open auction is waiting on its bidders, and
// otherwise it is simply whoever's turn it is. Returns a profileId or null.
export function hotSeatWaitingOn(state) {
  if (!state || !Array.isArray(state.players)) return null;
  // The CREW DRAFT is simultaneous, not turn-based: every seat owes a faction
  // pick and activeIndex does not advance between them. So the seat to play is
  // the first one that has not picked yet. (The card draft that can follow IS
  // turn-based, and falls through to activeIndex below like normal play.)
  const crewDraftOpen = state.draftPhase === 'crew'
    || (state.draftPhase == null && state.players.some((p) => !p.faction));
  if (crewDraftOpen) {
    const unpicked = state.players.find((p) => !p.faction);
    if (unpicked) return unpicked.profileId;
  }
  if (state.pendingSeniority && state.pendingSeniority.chooserId != null) {
    return state.pendingSeniority.chooserId;
  }
  if (state.pendingFirstPlayer && state.pendingFirstPlayer.chooserId != null) {
    return state.pendingFirstPlayer.chooserId;
  }
  // An open auction is waiting on whoever still owes it a bid or a pass. The
  // engine's own auctionWaitingOn is the authority for the roster display; here
  // we only need A reasonable default seat, so read the auction directly rather
  // than importing the engine into shared data.
  const a = state.auction;
  if (a) {
    if (a.awaiting === 'auctioneer') return a.auctioneerId;
    const acted = a.acted || [];
    const auto = a.autoPassed || [];
    const next = state.players.find((p) =>
      !sameId(p.profileId, a.auctioneerId)
      && !acted.some((id) => sameId(id, p.profileId))
      && !auto.some((id) => sameId(id, p.profileId)));
    if (next) return next.profileId;
    return a.auctioneerId;
  }
  const cur = state.players[state.activeIndex];
  return cur ? cur.profileId : null;
}

// Resolve which seat an incoming op is played AS.
//
// Only the owner of a hot-seat table gets any remapping: everyone else (a
// spectator, or a normal game's players) acts as themselves, exactly as before.
// The owner may name the seat explicitly with `actAs` - that is the honest
// model, since during an auction the table is waiting on several seats at once
// and no single "active player" exists. `actAs` is validated against the game's
// own roster, so it can only ever select a seat that is already at this table.
// With no `actAs` we fall back to the seat the table is waiting on, which keeps
// an older client (and every non-auction op) working untouched.
export function resolveHotSeatActor(state, callerId, actAs) {
  if (!isHotSeatOwner(state, callerId)) return callerId;
  if (actAs != null && actAs !== '') {
    const seat = (state.players || []).find((p) => sameId(p.profileId, actAs));
    // An unknown actAs is IGNORED rather than honoured: falling through to the
    // waiting seat keeps a stale client from acting as a seat that has left.
    if (seat) return seat.profileId;
  }
  return hotSeatWaitingOn(state) ?? callerId;
}
