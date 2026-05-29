// Bootstrap and top-level UI coordination.

import { probeServer, apiAvailable, lookupInviteLink, claimInviteLink, getLobbyByCode } from './api.js';
import {
  restoreProfile, activeProfile, signIn, signOut, mintDeviceCode,
  onProfileChange,
} from './auth.js';
import { ws } from './ws.js';
import {
  initLobby, refreshLobbyList, openLobby,
} from './lobby.js';
import {
  initInvites, refreshInvitesList, subscribeInvitesForProfile,
} from './invites.js';
import { mountBrowse, isBrowseOnline } from './game/browse.js';

const VIEWS = [
  'view-signin', 'view-lobby-list', 'view-create-lobby', 'view-lobby',
  'view-browse',
];

// Track which view the user was on before opening Browse, so the
// "back" affordance restores them instead of always punting to
// sign-in / lobby-list.
let _prevView = null;

function showView(id) {
  // Remember the view we're leaving so Browse → back returns properly.
  const current = VIEWS.find((v) => !document.getElementById(v).classList.contains('hidden'));
  if (current && current !== id && current !== 'view-browse') _prevView = current;
  console.log('[hf:nav] showView ->', id, '(from', current || '(none)', ')');
  for (const v of VIEWS) {
    document.getElementById(v).classList.toggle('hidden', v !== id);
  }
  // Body class drives lobby-only CSS (hides the floating FAB while the
  // lobby has its own inline ☰ button).
  document.body.classList.toggle('in-lobby', id === 'view-lobby-list');
  // Menu highlight. Lobby is the sole top-level context indicator:
  // current on the lobby views OR on view-browse when an online game is
  // driving it. Solo sandbox (view-browse, !online) has no menu button
  // to light up - it's only entered via "+ New game" in the lobby.
  const lobbyBtn = document.getElementById('btn-lobby');
  const inOnlineBrowse = id === 'view-browse' && isBrowseOnline();
  const inLobby = id === 'view-lobby-list' || id === 'view-lobby' || id === 'view-create-lobby';
  const lobbyCurrent = inOnlineBrowse || inLobby;
  if (lobbyBtn) {
    lobbyBtn.classList.toggle('is-current', lobbyCurrent);
    lobbyBtn.title = lobbyCurrent
      ? 'Lobby: already active'
      : 'Lobby: open tables, your games, global chat';
  }
}

// ----- Toasts -----

function toast(text, kind) {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 4000);
  setTimeout(() => { el.remove(); }, 4500);
}

// ----- Server-status pill -----

async function updateServerStatus() {
  const el = document.getElementById('server-status');
  if (!apiAvailable()) {
    el.textContent = 'local-only';
    el.className = 'server-status warn';
    return;
  }
  const ok = await probeServer();
  el.textContent = ok ? 'online' : 'offline';
  el.className = 'server-status ' + (ok ? 'ok' : 'bad');
}

// ----- Profile UI wiring -----

function reflectProfile(profile) {
  const pill = document.getElementById('profile-pill');
  const nameEl = document.getElementById('profile-name');
  const signin = document.getElementById('btn-signin');
  if (profile) {
    pill.classList.remove('hidden');
    signin.classList.add('hidden');
    nameEl.textContent = '@' + profile.name;
    document.getElementById('account-name').textContent = profile.name;
  } else {
    pill.classList.add('hidden');
    signin.classList.remove('hidden');
  }
}

// Browse view: read-only data inspector. Always reachable; doesn't
// require sign-in. The Browse module itself manages its tabs.
function initBrowseButton() {
  // The hamburger menu now exposes a single top-level nav button: the
  // Lobby (Sandbox is reached via "+ New game" in the lobby). Clicking
  // it from anywhere navigates to the lobby; no toggle / no previous-
  // view dance.
  const lobbyBtn = document.getElementById('btn-lobby');
  if (lobbyBtn) {
    lobbyBtn.addEventListener('click', () => {
      if (document.getElementById('view-lobby-list').classList.contains('hidden')) {
        showView('view-lobby-list');
      }
    });
  }

  // Menu fullscreen toggle. Uses the same browser API as the
  // map-toolbar button; this one promotes the whole page so the
  // sidepanel + hand strip come along for the ride. Label
  // includes "Fullscreen" so the menu reads as a verb row;
  // fullscreenchange flips the glyph between enter / exit.
  const fsBtn = document.getElementById('btn-fullscreen');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        document.documentElement.requestFullscreen?.();
      }
    });
    document.addEventListener('fullscreenchange', () => {
      fsBtn.textContent = document.fullscreenElement
        ? '⤬ Exit fullscreen'
        : '⛶ Fullscreen';
    });
  }
}

// Hamburger menu wiring. The modal carries the buttons formerly
// pinned to the topbar; opening it is a single ☰ tap. Picking
// Sandbox / Multiplayer / Sign in auto-closes so the player
// isn't stuck behind a backdrop they have to dismiss before
// using the view they just chose.
function initMainMenu() {
  const fab     = document.getElementById('btn-main-menu');
  const overlay = document.getElementById('main-menu-modal');
  const closeBtn = document.getElementById('btn-main-menu-close');
  if (!fab || !overlay) return;
  const open = () => {
    overlay.classList.remove('hidden');
    document.addEventListener('keydown', onKey);
  };
  const close = () => {
    overlay.classList.add('hidden');
    document.removeEventListener('keydown', onKey);
    // Tear down any open account popover too so it doesn't get
    // stranded over an empty backdrop.
    const acct = document.getElementById('account-menu');
    if (acct && !acct.classList.contains('hidden')) acct.classList.add('hidden');
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  fab.addEventListener('click', () => {
    if (overlay.classList.contains('hidden')) open(); else close();
  });
  // The lobby has its own inline ☰ button (the floating FAB is hidden
  // there - see body.in-lobby CSS). Wire it to the same toggle.
  const inlineMenu = document.getElementById('btn-menu-inline');
  if (inlineMenu) {
    inlineMenu.addEventListener('click', () => {
      if (overlay.classList.contains('hidden')) open(); else close();
    });
  }
  closeBtn?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // Auto-close on a view-switching action - same idiom as any
  // off-canvas menu. Fullscreen + account-menu stay open because
  // the user usually wants to flip a setting and keep browsing.
  for (const id of ['btn-lobby', 'btn-signin']) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', close);
  }
}

// "+ New game" chooser modal: opened from the lobby's top action row
// (#btn-new-game). Picks Multiplayer (-> view-create-lobby) or Sandbox
// (-> view-browse solo mount). Mirrors initMainMenu's overlay flow.
function initNewGameModal() {
  const trigger = document.getElementById('btn-new-game');
  const overlay = document.getElementById('new-game-modal');
  const closeBtn = document.getElementById('btn-new-game-close');
  const mpBtn = document.getElementById('btn-new-game-mp');
  const sandboxBtn = document.getElementById('btn-new-game-sandbox');
  if (!trigger || !overlay || !closeBtn || !mpBtn || !sandboxBtn) return;
  const open = () => {
    overlay.classList.remove('hidden');
    document.addEventListener('keydown', onKey);
  };
  const close = () => {
    overlay.classList.add('hidden');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  trigger.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  mpBtn.addEventListener('click', () => {
    close();
    showView('view-create-lobby');
  });
  sandboxBtn.addEventListener('click', () => {
    close();
    // Solo sandbox lives in view-browse with no opts; mountBrowse's
    // safety reset detaches any prior online plumbing automatically.
    showView('view-browse');
    mountBrowse();
  });
}

function initAccountMenu() {
  const menu = document.getElementById('account-menu');
  document.getElementById('btn-account').addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu.classList.toggle('hidden');
  });
  document.addEventListener('click', (ev) => {
    if (!menu.classList.contains('hidden')
        && !menu.contains(ev.target)
        && ev.target.id !== 'btn-account') {
      menu.classList.add('hidden');
    }
  });
  document.getElementById('btn-add-device').addEventListener('click', async () => {
    const box = document.getElementById('device-code-box');
    const val = document.getElementById('device-code-value');
    val.value = 'minting…';
    box.classList.remove('hidden');
    const r = await mintDeviceCode();
    if (!r.ok) { val.value = 'error: ' + r.error; return; }
    val.value = r.token;
    val.select();
  });
  document.getElementById('btn-copy-device-code').addEventListener('click', () => {
    const val = document.getElementById('device-code-value');
    val.select();
    if (navigator.clipboard) navigator.clipboard.writeText(val.value);
    document.getElementById('btn-copy-device-code').textContent = 'Copied';
    setTimeout(() => { document.getElementById('btn-copy-device-code').textContent = 'Copy'; }, 1200);
  });
  document.getElementById('btn-signout').addEventListener('click', () => {
    signOut();
    ws.disconnect();
    menu.classList.add('hidden');
    showView('view-signin');
    toast('Signed out.', 'success');
  });
}

function initSigninForm() {
  document.getElementById('btn-signin').addEventListener('click', () => {
    showView('view-signin');
  });
  document.getElementById('form-signin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('signin-error');
    err.textContent = '';
    const name = document.getElementById('signin-name').value.trim();
    const code = document.getElementById('signin-code').value.trim();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true;
    const r = await signIn({ name, deviceCode: code });
    btn.disabled = false;
    if (!r.ok) {
      err.textContent = humanizeError(r.error);
      return;
    }
    document.getElementById('signin-name').value = '';
    document.getElementById('signin-code').value = '';
    await afterSignIn();
  });
}

async function afterSignIn() {
  const me = activeProfile();
  if (!me) return;
  ws.connect(me.token);
  // Personal channel subscribes itself once auth_ok arrives (see
  // invites.js). Pre-register intent so reconnects respect it.
  subscribeInvitesForProfile(me);
  showView('view-lobby-list');
  refreshLobbyList();
  refreshInvitesList();
  // If the user landed on a `?invite=<code>` URL, claim it now.
  await maybeClaimInviteFromUrl();
}

// Returns true if it navigated the user into a lobby (so the caller
// ?room=<code>: a fresh page load (refresh, restored tab, WS-lost
// reconnect) that carries the lobby's 6-char share code re-opens
// the lobby instead of dropping the player on the lobby list.
// Returns true on a successful openLobby (caller skips the lobby-
// list fallback), false otherwise.
async function maybeResumeRoomFromUrl() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('room');
  if (!code) return false;
  try {
    const r = await getLobbyByCode(code);
    if (!r || !r.ok || !r.data || !r.data.id) {
      // Stale code (lobby cancelled or 404). Clear it so we don't
      // keep trying on every load.
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      return false;
    }
    await openLobby(r.data.id, { join: false });
    return true;
  } catch (err) {
    console.error('[hf:boot] room resume failed:', err);
    return false;
  }
}

// skips the resume / sandbox fallback).
async function maybeClaimInviteFromUrl() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('invite');
  if (!code) return false;
  // Clear from the URL so a refresh doesn't double-claim.
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  const me = activeProfile();
  if (!me) {
    toast('Sign in to claim that invite link.', 'invite');
    return false;
  }
  const peek = await lookupInviteLink(code);
  if (!peek.ok) { toast('Invite link not found.', 'error'); return false; }
  if (peek.data.expired) { toast('That invite link expired.', 'error'); return false; }
  if (peek.data.used)    { toast('That invite link is used up.', 'error'); return false; }
  const r = await claimInviteLink(code, me.token);
  if (!r.ok) { toast('Couldn\'t claim invite: ' + r.error, 'error'); return false; }
  toast(`Joined "${peek.data.lobbyName}".`, 'success');
  await openLobby(r.data.lobbyId, { join: false });
  return true;
}

function humanizeError(code) {
  return ({
    invalid_name: 'Name must be 3-20 letters/numbers/_/-.',
    invalid_token: 'Device code looks wrong.',
    name_taken: 'That name is taken - paste a device code or pick another name.',
    rate_limited: 'Too many sign-in attempts. Wait an hour.',
    api_unavailable: 'Server is unreachable. Sign-in requires a server.',
    network: 'Network error. Try again in a moment.',
  })[code] || code;
}

// ----- Boot -----

async function boot() {
  console.log('[hf:boot] start');
  initSigninForm();
  initAccountMenu();
  initLobby({ onShowView: showView, onToast: toast });
  initInvites({ onToast: toast });
  initBrowseButton();
  initMainMenu();
  initNewGameModal();
  onProfileChange(reflectProfile);

  await updateServerStatus();
  const me = await restoreProfile();
  reflectProfile(me);

  if (me) {
    console.log('[hf:boot] signed in as @' + me.name + ' (id=' + me.id + ')');
    ws.connect(me.token);
    subscribeInvitesForProfile(me);
    // Keep the multiplayer view populated for when the player switches.
    refreshLobbyList();
    refreshInvitesList();
    // Landing priority: a `?invite=` URL wins; otherwise always land on
    // the lobby. Auto-resume is gone - a player can have several games
    // going at once, so jumping straight into one is presumptuous. Each
    // game has a Resume button in "Your games".
    const claimed = await maybeClaimInviteFromUrl();
    console.log('[hf:boot] inviteClaimed=', claimed);
    if (!claimed) {
      // ?room=<code> URL bootstrap: a refresh / reconnect drops the
      // player back into the same lobby instead of the lobby list.
      // setRoomInUrl in lobby.js writes the param when openLobby
      // succeeds, and clears it on leaveCurrent. Failure (lobby
      // cancelled, code stale, network error) falls through to the
      // default landing.
      const resumed = await maybeResumeRoomFromUrl();
      console.log('[hf:boot] roomResumed=', resumed);
      if (!resumed) {
        console.log('[hf:boot] landing on lobby (default)');
        showView('view-lobby-list');
      }
    }
  } else {
    console.log('[hf:boot] no profile - going to signin');
    showView('view-signin');
    // If the URL has an invite code, stash a note so the user sees it
    // after they sign in.
    const url = new URL(window.location.href);
    if (url.searchParams.get('invite')) {
      const peek = await lookupInviteLink(url.searchParams.get('invite'));
      if (peek.ok) {
        toast(`Sign in to join "${peek.data.lobbyName}".`, 'invite');
      }
    }
  }

  // Re-poll status every 30s so the user can see when the server
  // comes back. Cheap call (a /healthz GET).
  setInterval(updateServerStatus, 30_000);
}

document.addEventListener('DOMContentLoaded', boot);
