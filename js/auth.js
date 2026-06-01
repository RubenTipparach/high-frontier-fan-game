// Profile lifecycle: claim, restore, sign out, add-device.
//
// The active profile is `{ name, token, id }`, persisted in
// localStorage as 'hf.profile'. On boot we restore from disk, probe
// /profiles/me to confirm the token is still good, and demote to
// signed-out if the server says no.

import {
  claimProfile, whoami, issueDeviceCode, apiAvailable,
} from './api.js';
import {
  loadProfile, saveProfile, clearProfile, generateToken,
} from './storage.js';

let _active = null;
const _listeners = new Set();

export function activeProfile() { return _active; }

export function onProfileChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _publish() {
  for (const fn of _listeners) {
    try { fn(_active); } catch (err) { console.error('profile listener', err); }
  }
}

// Restore from localStorage, confirm with the server. If the server
// 401s the stored token, drop it locally. If the server is
// unreachable, keep the profile in-memory so the user still sees
// their name; subsequent API calls will fail-soft.
export async function restoreProfile() {
  const stored = loadProfile();
  if (!stored) { _active = null; _publish(); return null; }
  _active = stored;
  _publish();
  if (!apiAvailable()) return _active;
  const r = await whoami(stored.token);
  if (r.ok) {
    // Refresh id/name from the server in case anything drifted.
    _active = { ...stored, id: r.data.id, name: r.data.name };
    saveProfile(_active);
    _publish();
    return _active;
  }
  if (r.status === 401) {
    clearProfile();
    _active = null;
    _publish();
    return null;
  }
  // Transport error: keep the stored profile in place. User is still
  // "signed in" optimistically; the next mutating call will surface
  // the network problem if it persists.
  return _active;
}

// Either claim a brand new profile, or attach this device to an
// existing profile via a device code. The device-code path uses the
// provided code as the token directly - the server treats it as one
// of the profile's valid bearer credentials.
//
// Returns { ok, error?, profile? }.
export async function signIn({ name, deviceCode }) {
  if (!apiAvailable()) {
    return { ok: false, error: 'api_unavailable' };
  }
  const token = deviceCode && deviceCode.length === 8
    ? deviceCode.toLowerCase()
    : generateToken();
  const r = await claimProfile(name, token);
  if (!r.ok) return { ok: false, error: r.error };
  const profile = { name, token, id: r.data && r.data.id };
  _active = profile;
  saveProfile(profile);
  _publish();
  return { ok: true, profile };
}

// Adopt a session the SERVER minted (Discord sign-in / sign-up). Unlike
// signIn(), the token is generated server-side and handed back through
// the OAuth handoff; we just store it like any other profile credential.
export function adoptServerSession({ token, id, name }) {
  if (!token || !name) return null;
  // A Discord-minted session is, by definition, already Discord-linked.
  const profile = { name, token, id, discordLinked: true };
  _active = profile;
  saveProfile(profile);
  _publish();
  return profile;
}

// Mark the active profile as Discord-linked (after the account-menu
// "Connect to Discord" flow completes) so the connect button hides.
export function markDiscordLinked() {
  if (!_active) return;
  _active = { ..._active, discordLinked: true };
  saveProfile(_active);
  _publish();
}

export function signOut() {
  clearProfile();
  _active = null;
  _publish();
}

export async function mintDeviceCode() {
  if (!_active) return { ok: false, error: 'not_signed_in' };
  const r = await issueDeviceCode(_active.token);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, token: r.data.token };
}
