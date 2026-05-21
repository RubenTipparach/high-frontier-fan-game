// localStorage helpers. One namespace: 'hf.*'.

const LS_PROFILE = 'hf.profile';
const LS_LAST_LOBBY = 'hf.lastLobbyId';

// A profile here is { name, token, id, createdAt, lastSeenAt }. The
// token is a 32-byte base64url secret generated client-side; the
// server stores sha256(token) and uses it as the bearer credential.
//
// Only ONE active profile per device. Switching profiles (sign out
// and sign in as someone else) overwrites this slot; the previous
// token is forgotten on this device but the profile still works on
// any other device the user has signed in on.
export function loadProfile() {
  try {
    const raw = localStorage.getItem(LS_PROFILE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== 'string' || typeof parsed.token !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
}

export function clearProfile() {
  localStorage.removeItem(LS_PROFILE);
}

// 32 random bytes, base64url encoded, no padding. Same shape as the
// murdoku token; the server accepts it as a "legacy" 43-char token.
export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function loadLastLobbyId() {
  const v = localStorage.getItem(LS_LAST_LOBBY);
  return v ? Number(v) : null;
}

export function saveLastLobbyId(id) {
  if (id) localStorage.setItem(LS_LAST_LOBBY, String(id));
  else localStorage.removeItem(LS_LAST_LOBBY);
}
