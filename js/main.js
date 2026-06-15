// Bootstrap and top-level UI coordination.

import { probeServer, apiAvailable, lookupInviteLink, claimInviteLink, getLobbyByCode,
  getNotifyPrefs, setNotifyPrefs, testNotify, startDiscordOauth, whoami,
  discordSignInEnabled, discordLoginStartUrl, discordExchange, discordSignup } from './api.js';
import {
  restoreProfile, activeProfile, signIn, signOut, mintDeviceCode,
  adoptServerSession, markDiscordLinked, onProfileChange,
} from './auth.js';
import { ws } from './ws.js';
import {
  initLobby, refreshLobbyList, openLobby, exitToLobbyList, createSoloRoom,
} from './lobby.js';
import {
  initInvites, refreshInvitesList, subscribeInvitesForProfile,
} from './invites.js';
import { mountBrowse, isBrowseOnline, refreshRoomOverlays, requestRocketFocus } from './game/browse.js';
import { newSandboxGame, currentSandboxId, activateSandboxGame } from './game/sandbox-games.js';
import { appBase } from './base.js';
import { initErudaFromPref } from './debug-console.js';

const VIEWS = [
  'view-signin', 'view-lobby-list', 'view-create-lobby', 'view-lobby',
  'view-browse',
];

// Track which view the user was on before opening Browse, so the
// "back" affordance restores them instead of always punting to
// sign-in / lobby-list.
let _prevView = null;

// appBase() comes from ./base.js - the single, bundling-safe source of the
// app base path (the address bar can already be a deep /room or /sandbox).

// Write the URL for the given view. React-router style: switching views
// rewrites the path so a refresh / shared link / restore lands on the
// same surface. The room paths are owned by lobby.js#setRoomInUrl (it
// knows the active lobby's code); showView calls this only for the
// non-room destinations. ?v=<sha> + hash are preserved.
function setUrlForView(view) {
  try {
    const base = appBase();
    const cur = new URL(window.location.href);
    const v = cur.searchParams.get('v');
    const search = v ? '?v=' + encodeURIComponent(v) : '';
    let path;
    if (view === 'view-browse') {
      // Solo sandbox; the online case is handled by setRoomInUrl
      // (called from lobby.js#enterLobby when the lobby's game has
      // started) and short-circuits via the early-return in
      // showView's URL block. Each solo game routes to /sandbox/<id>.
      const sid = currentSandboxId();
      path = base + 'sandbox' + (sid ? '/' + sid : '');
    } else if (view === 'view-lobby-list' || view === 'view-create-lobby') {
      path = base + 'lobby';
    } else if (view === 'view-lobby') {
      // The lobby room view's URL is owned by setRoomInUrl - don't
      // overwrite it here or we'd race with enterLobby's path push.
      return;
    } else if (view === 'view-signin') {
      path = base;
    } else {
      path = base;
    }
    window.history.replaceState({}, '', path + search + cur.hash);
  } catch { /* private mode / file:// */ }
}

function showView(id) {
  // Remember the view we're leaving so Browse → back returns properly.
  const current = VIEWS.find((v) => !document.getElementById(v).classList.contains('hidden'));
  if (current && current !== id && current !== 'view-browse') _prevView = current;
  console.log('[hf:nav] showView ->', id, '(from', current || '(none)', ')');
  for (const v of VIEWS) {
    document.getElementById(v).classList.toggle('hidden', v !== id);
  }
  // The crew-draft / auction overlays attach to document.body and the
  // snapshot poll is seq-gated, so a poll alone won't tear them down
  // when the player navigates away (e.g. the top-menu Lobby button,
  // which doesn't unmount the online layer). Re-sync them on every view
  // switch: they remove themselves off the game room and re-appear from
  // the cached snapshot on return.
  refreshRoomOverlays();
  // URL <-> view mapping. Online view-browse keeps its /room/<code>
  // form (lobby.js#setRoomInUrl wrote it on enterLobby); everything
  // else routes through setUrlForView.
  if (!(id === 'view-browse' && isBrowseOnline())) {
    setUrlForView(id);
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

// Show the account-menu "Connect to Discord" button only for a signed-in
// user whose account ISN'T linked yet, on a deployment that has Discord
// OAuth. Fetches fresh status from the server so it reflects links made
// on other devices. Hidden in every other case.
async function refreshDiscordLinkButton() {
  const btn = document.getElementById('btn-connect-discord-acct');
  if (!btn) return;
  const me = activeProfile();
  if (!me || !apiAvailable()) { btn.hidden = true; return; }
  // Fast path: a Discord-minted / freshly-linked session knows it's linked.
  if (me.discordLinked) { btn.hidden = true; return; }
  const r = await whoami(me.token);
  const show = r.ok && r.data && r.data.oauthEnabled && !r.data.discordLinked;
  btn.hidden = !show;
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
      // Always exit the current room: detach the online game layer and
      // clear the /room/<CODE> path so the URL returns to the lobby
      // list, where the player can enter another room or a sandbox.
      // (Keeps server-side membership; Resume puts them back in.)
      exitToLobbyList();
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
    loadNotifySection();   // refresh the turn-notification prefs each open
  };
  const close = () => {
    overlay.classList.add('hidden');
    document.removeEventListener('keydown', onKey);
    // Tear down any open account popover too so it doesn't get
    // stranded over an empty backdrop.
    const acct = document.getElementById('account-menu');
    if (acct && !acct.classList.contains('hidden')) acct.classList.add('hidden');
  };
  wireNotifySection();
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

// Turn-notification settings (in the menu modal). Opt-in Discord DM:
// load the caller's prefs on open, save / test on demand. Hidden entirely
// when there's no signed-in profile; shows a "no bot" note when the server
// has no DISCORD_BOT_TOKEN.
let _notifyWired = false;
// Cached so the OAuth popup-poll and the manual save can re-read the
// last server state without another round-trip.
let _notifyPrefs = {};
async function loadNotifySection() {
  const section = document.getElementById('notify-section');
  if (!section) return;
  const me = activeProfile();
  if (!me || !apiAvailable()) { section.hidden = true; return; }
  section.hidden = false;
  const r = await getNotifyPrefs(me.token);
  if (!r.ok) { section.hidden = true; return; }
  const d = _notifyPrefs = r.data || {};

  const idEl = document.getElementById('notify-discord-id');
  const turnEl = document.getElementById('notify-turn');
  const aucEl = document.getElementById('notify-auction');
  const disabledNote = document.getElementById('notify-disabled-note');
  const oauthWrap = document.getElementById('notify-oauth');
  const manualWrap = document.getElementById('notify-manual-wrap');
  const connectedEl = document.getElementById('notify-connected');
  const connectBtn = document.getElementById('btn-notify-connect');
  const testBtn = document.getElementById('btn-notify-test');

  const off = !d.discordEnabled;          // no bot token at all
  const oauthOn = !!d.oauthEnabled;       // one-click flow available
  const connected = /^\d{5,25}$/.test(d.discordUserId || '');

  if (idEl) idEl.value = d.discordUserId || '';
  if (turnEl) turnEl.checked = d.notifyTurn !== false;
  if (aucEl) aucEl.checked = d.notifyAuction !== false;
  if (disabledNote) disabledNote.hidden = !off;

  // OAuth block visible only when the server supports it. The manual
  // user-id block is always present; when OAuth is on it's collapsed
  // under its <details> disclosure (a fallback), otherwise it's the
  // primary path so we open it.
  if (oauthWrap) oauthWrap.hidden = !oauthOn;
  if (manualWrap) manualWrap.open = !oauthOn;
  if (connectedEl) connectedEl.hidden = !connected;
  if (connectBtn) {
    connectBtn.disabled = off;
    connectBtn.textContent = connected ? 'Reconnect Discord' : 'Connect Discord';
  }
  // Send test DM only works once a bot exists AND an id is linked.
  if (testBtn) testBtn.disabled = off || !connected;

  for (const el of [idEl, turnEl, aucEl,
    document.getElementById('btn-notify-save'),
    document.getElementById('btn-notify-save-manual')]) {
    if (el) el.disabled = false;
  }
  const status = document.getElementById('notify-status');
  if (status) status.textContent = '';
}
function wireNotifySection() {
  if (_notifyWired) return;
  _notifyWired = true;
  const status = document.getElementById('notify-status');
  const setStatus = (t) => { if (status) status.textContent = t; };
  const collectPrefs = () => ({
    // Keep the already-linked id; the checkboxes are the editable part
    // of the OAuth block. Manual save (below) supplies its own id.
    discordUserId: _notifyPrefs.discordUserId || '',
    notifyTurn: !!document.getElementById('notify-turn')?.checked,
    notifyAuction: !!document.getElementById('notify-auction')?.checked,
  });

  // Save the event-kind checkboxes (OAuth block).
  document.getElementById('btn-notify-save')?.addEventListener('click', async () => {
    const me = activeProfile();
    if (!me) return;
    setStatus('Saving…');
    const r = await setNotifyPrefs(collectPrefs(), me.token);
    setStatus(r.ok ? 'Saved.' : `Couldn't save: ${r.error || 'error'}`);
  });

  // Save a manually-pasted user id (fallback block).
  document.getElementById('btn-notify-save-manual')?.addEventListener('click', async () => {
    const me = activeProfile();
    if (!me) return;
    const id = (document.getElementById('notify-discord-id')?.value || '').trim();
    if (id && !/^\d{5,25}$/.test(id)) { setStatus('That doesn\'t look like a Discord user ID.'); return; }
    setStatus('Saving…');
    const r = await setNotifyPrefs({
      discordUserId: id,
      notifyTurn: !!document.getElementById('notify-turn')?.checked,
      notifyAuction: !!document.getElementById('notify-auction')?.checked,
    }, me.token);
    if (r.ok) { _notifyPrefs.discordUserId = id; await loadNotifySection(); setStatus('Saved.'); }
    else setStatus(`Couldn't save: ${r.error || 'error'}`);
  });

  // One-click "Connect Discord": open the authorize URL in a popup, then
  // poll prefs until the server-side callback links the account.
  document.getElementById('btn-notify-connect')?.addEventListener('click', async () => {
    const me = activeProfile();
    if (!me) return;
    setStatus('Opening Discord…');
    const r = await startDiscordOauth(me.token);
    if (!r.ok || !r.data || !r.data.url) {
      setStatus(`Couldn't start: ${humanizeNotifyError(r.error)}`);
      return;
    }
    const popup = window.open(r.data.url, 'hf-discord-oauth', 'width=520,height=720');
    if (!popup) { setStatus('Allow popups, then click Connect again.'); return; }
    setStatus('Approve in the Discord window, then come back…');
    // Poll for the linked id (the callback runs server-side; the popup
    // self-closes on success). Give up after ~2 minutes.
    const started = Date.now();
    const tick = setInterval(async () => {
      if (Date.now() - started > 120000) { clearInterval(tick); return; }
      const p = await getNotifyPrefs(me.token);
      if (p.ok && /^\d{5,25}$/.test((p.data && p.data.discordUserId) || '')) {
        clearInterval(tick);
        await loadNotifySection();
        setStatus('Discord connected. Try Send test DM.');
        try { popup.close(); } catch { /* cross-origin close may throw */ }
      }
    }, 2000);
  });

  document.getElementById('btn-notify-test')?.addEventListener('click', async () => {
    const me = activeProfile();
    if (!me) return;
    const id = (_notifyPrefs.discordUserId
      || document.getElementById('notify-discord-id')?.value || '').trim();
    if (!/^\d{5,25}$/.test(id)) { setStatus('Connect Discord (or enter a user ID) first.'); return; }
    setStatus('Sending test DM…');
    const r = await testNotify(id, me.token);
    setStatus(r.ok
      ? 'Test DM sent - check your Discord.'
      : `Test failed: ${humanizeNotifyError(r.error)}`);
  });
}
function humanizeNotifyError(code) {
  return ({
    discord_disabled: 'this server has no notification bot configured.',
    oauth_disabled: 'one-click Discord linking isn\'t set up on this server.',
    bad_discord_id: 'that doesn\'t look like a Discord user ID.',
  })[code] || (code ? `the bot couldn't reach you (${code}).` : 'unknown error.');
}

// "+ New game" chooser modal: opened from the lobby's top action row
// (#btn-new-game). Picks Multiplayer (-> view-create-lobby) or Sandbox
// (-> view-browse solo mount). Mirrors initMainMenu's overlay flow.
function initNewGameModal() {
  const trigger = document.getElementById('btn-new-game');
  const overlay = document.getElementById('new-game-modal');
  const closeBtn = document.getElementById('btn-new-game-close');
  const mpBtn = document.getElementById('btn-new-game-mp');
  const soloBtn = document.getElementById('btn-new-game-solo');
  const sandboxBtn = document.getElementById('btn-new-game-sandbox');
  const modeSection = document.getElementById('new-game-mode');
  const legacyWarn = document.getElementById('new-game-legacy-warn');
  const legacyContinue = document.getElementById('btn-legacy-continue');
  const legacyBack = document.getElementById('btn-legacy-back');
  const soloOpts = document.getElementById('new-game-solo-opts');
  const soloCreate = document.getElementById('btn-solo-create');
  const soloBack = document.getElementById('btn-solo-back');
  if (!trigger || !overlay || !closeBtn || !mpBtn || !soloBtn || !sandboxBtn) return;
  // Reset to the mode chooser (hide the sub-steps).
  const showMode = () => {
    if (modeSection) modeSection.classList.remove('hidden');
    if (legacyWarn) legacyWarn.classList.add('hidden');
    if (soloOpts) soloOpts.classList.add('hidden');
  };
  const open = () => {
    showMode();
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
  // Solo room: pick the sandbox-style options first (starting bank + card
  // economy), then create + start a private 1-player server game.
  soloBtn.addEventListener('click', () => {
    if (modeSection) modeSection.classList.add('hidden');
    if (soloOpts) soloOpts.classList.remove('hidden');
  });
  // Option toggles: activating one button in a group deactivates its siblings.
  if (soloOpts) {
    soloOpts.querySelectorAll('.solo-opt-group').forEach((group) => {
      group.querySelectorAll('.solo-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          group.querySelectorAll('.solo-opt').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
        });
      });
    });
  }
  if (soloBack) soloBack.addEventListener('click', showMode);
  if (soloCreate) soloCreate.addEventListener('click', async () => {
    const aquaBtn = soloOpts && soloOpts.querySelector('.solo-opt.is-active[data-aqua]');
    const econBtn = soloOpts && soloOpts.querySelector('.solo-opt.is-active[data-econ]');
    const roundsBtn = soloOpts && soloOpts.querySelector('.solo-opt.is-active[data-rounds]');
    const startingAqua = aquaBtn ? Number(aquaBtn.dataset.aqua) : 100;
    const economy = econBtn ? econBtn.dataset.econ : 'library';
    const maxRounds = roundsBtn ? Number(roundsBtn.dataset.rounds) : 5;
    const draftStart = !!document.getElementById('solo-draft')?.checked;
    const m0 = !!document.getElementById('solo-m0')?.checked;
    soloCreate.disabled = true;
    const prev = soloCreate.textContent;
    soloCreate.textContent = 'Creating room…';
    try {
      const r = await createSoloRoom({ startingAqua, economy, maxRounds, draftStart, m0 });
      if (r && r.ok) { close(); }
      else { toast('Could not start a solo room: ' + ((r && r.error) || 'network'), 'error'); }
    } catch (err) {
      console.error('solo room:', err);
      toast('Could not start a solo room.', 'error');
    } finally {
      soloCreate.disabled = false;
      soloCreate.textContent = prev;
    }
  });
  // Offline sandbox is now behind a warning (device-only, no multiplayer).
  sandboxBtn.addEventListener('click', () => {
    if (modeSection) modeSection.classList.add('hidden');
    if (legacyWarn) legacyWarn.classList.remove('hidden');
  });
  if (legacyBack) legacyBack.addEventListener('click', showMode);
  if (legacyContinue) legacyContinue.addEventListener('click', () => {
    close();
    // A fresh solo session: register a new sandbox game id (so it shows in
    // "Your games" + routes to /sandbox/<id>), then mount with newGame so
    // every state module resets and no prior game bleeds in.
    newSandboxGame();
    showView('view-browse');   // setUrlForView reads currentSandboxId()
    mountBrowse({ newGame: true });
  });
}

function initAccountMenu() {
  const menu = document.getElementById('account-menu');
  document.getElementById('btn-account').addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu.classList.toggle('hidden');
    // Re-check link status each time the menu opens so the Connect
    // button reflects the latest state (e.g. linked from another device).
    if (!menu.classList.contains('hidden')) refreshDiscordLinkButton();
  });
  // "Connect to Discord": migrate this username/token account to Discord
  // by linking a Discord ID (reuses the same OAuth popup as notifications;
  // the callback records the auth identity). Polls until linked, then the
  // button hides for good.
  document.getElementById('btn-connect-discord-acct')?.addEventListener('click', async () => {
    const me = activeProfile();
    if (!me) return;
    const btn = document.getElementById('btn-connect-discord-acct');
    btn.disabled = true;
    const r = await startDiscordOauth(me.token);
    btn.disabled = false;
    if (!r.ok || !r.data || !r.data.url) {
      toast('Could not start Discord linking. Try again.', 'error');
      return;
    }
    const popup = window.open(r.data.url, 'hf-discord-link', 'width=520,height=720');
    if (!popup) { toast('Allow popups, then click Connect again.', 'error'); return; }
    toast('Approve in the Discord window…');
    const started = Date.now();
    const tick = setInterval(async () => {
      if (Date.now() - started > 120000) { clearInterval(tick); return; }
      const w = await whoami(me.token);
      if (w.ok && w.data && w.data.discordLinked) {
        clearInterval(tick);
        markDiscordLinked();            // updates state + hides via refresh below
        refreshDiscordLinkButton();
        toast('Discord connected to your account.', 'success');
        try { popup.close(); } catch { /* cross-origin close may throw */ }
      }
    }, 2000);
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

  // Layout: when Discord sign-in is available, it's the primary action
  // and the name/device-code form collapses under the "Other" disclosure.
  // When it's NOT available, expand that form and hide the "Other" summary
  // so it's simply the sign-in form.
  const discordWrap = document.getElementById('signin-discord-wrap');
  const discordBtn = document.getElementById('btn-signin-discord');
  const otherWrap = document.getElementById('signin-other');
  if (discordBtn) {
    discordBtn.addEventListener('click', () => {
      const url = discordLoginStartUrl();
      if (url) window.location.href = url;
    });
  }
  const applyDiscordLayout = (enabled) => {
    if (discordWrap) discordWrap.hidden = !enabled;
    if (otherWrap) {
      otherWrap.open = !enabled;                       // expanded when it's the only option
      otherWrap.classList.toggle('solo', !enabled);    // hides the summary (see CSS)
    }
  };
  if (apiAvailable()) {
    discordSignInEnabled().then((r) => {
      applyDiscordLayout(!!(r && r.ok && r.data && r.data.enabled));
    });
  } else {
    applyDiscordLayout(false);
  }

  // First-time Discord sign-up: the name-prompt modal's confirm handler.
  const nameForm = document.getElementById('form-discord-name');
  if (nameForm) {
    nameForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('discord-name-error');
      err.textContent = '';
      const name = document.getElementById('discord-name-input').value.trim();
      const btn = ev.target.querySelector('button[type=submit]');
      if (!_pendingDiscordSignupCode) { err.textContent = 'This sign-in expired. Try again.'; return; }
      btn.disabled = true;
      const r = await discordSignup(_pendingDiscordSignupCode, name);
      btn.disabled = false;
      if (!r.ok) { err.textContent = humanizeError(r.error); return; }
      _pendingDiscordSignupCode = null;
      document.getElementById('discord-name-modal').classList.add('hidden');
      adoptServerSession({ token: r.data.token, id: r.data.id, name: r.data.name });
      await afterSignIn();
    });
  }
}

// Holds the signup handoff code while the name-prompt modal is open.
let _pendingDiscordSignupCode = null;

// On boot, handle a `?hf_discord=...` redirect from the Discord sign-in
// flow. Returns true if it signed the user in (so boot can skip the
// normal signed-out landing). 'login' -> exchange for a token; 'signup'
// -> show the name prompt; 'error' -> toast and fall through.
async function maybeHandleDiscordAuth() {
  const url = new URL(window.location.href);
  const kind = url.searchParams.get('hf_discord');
  if (!kind) return false;
  const code = url.searchParams.get('code') || '';
  const reason = url.searchParams.get('reason') || '';
  // Scrub the params so a refresh / share doesn't replay them.
  url.searchParams.delete('hf_discord');
  url.searchParams.delete('code');
  url.searchParams.delete('reason');
  window.history.replaceState({}, '', url.toString());

  if (kind === 'error') {
    const msg = ({
      disabled: 'Discord sign-in is not enabled on this server.',
      cancelled: 'Discord sign-in was cancelled.',
      expired: 'That sign-in link expired. Please try again.',
    })[reason] || 'Discord sign-in did not complete. Please try again.';
    toast(msg, 'error');
    return false;
  }
  if (kind === 'login' || kind === 'signup') {
    const r = await discordExchange(code);
    if (!r.ok || !r.data) {
      toast('Discord sign-in link expired. Please try again.', 'error');
      return false;
    }
    if (r.data.status === 'signedin') {
      adoptServerSession({ token: r.data.token, id: r.data.id, name: r.data.name });
      await afterSignIn();
      return true;
    }
    if (r.data.status === 'needName') {
      _pendingDiscordSignupCode = code;
      showView('view-signin');
      const input = document.getElementById('discord-name-input');
      if (input) input.value = r.data.suggestedName || '';
      document.getElementById('discord-name-modal').classList.remove('hidden');
      return true; // handled (the modal drives the rest)
    }
  }
  return false;
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
  refreshDiscordLinkButton();
  // If the user landed on a `?invite=<code>` URL, claim it now.
  await maybeClaimInviteFromUrl();
}

// Returns true if it navigated the user into a lobby (so the caller
// Read the room code from (in priority order):
//   1. the 404.html sessionStorage stash (a hard load / version-bump
//      reload of /room/<CODE> bounces through 404.html, which stashes
//      the code and redirects to the app root),
//   2. the /room/<CODE> path itself (in case GH Pages ever serves it
//      directly, or a future host with real routing),
//   3. the legacy ?room=<CODE> query (old shared links still work).
// Server codes use CODE_ALPHABET = lowercase + digits, length 6.
// Reject anything else BEFORE hitting the API so a stray path segment
// (e.g. /room/<garbage>) doesn't trigger a 404 round-trip, and so a
// mixed-case copy-pasted link still resolves.
const ROOM_CODE_RE = /^[0-9a-z]{4,12}$/;
function normaliseRoomCode(raw) {
  if (raw == null) return null;
  const c = String(raw).trim().toLowerCase();
  return ROOM_CODE_RE.test(c) ? c : null;
}

// Landing intent ('lobby' | 'sandbox' | null) resolved from (in
// priority order): the 404.html sessionStorage stash, or the visible
// path if the host server happened to serve index.html directly for
// /lobby or /sandbox. Null falls through to the default lobby landing.
function readLandingIntent() {
  try {
    const stashed = sessionStorage.getItem('hf-landing-redirect');
    if (stashed) {
      sessionStorage.removeItem('hf-landing-redirect');
      if (stashed === 'sandbox') return 'sandbox';
      if (stashed === 'lobby') return 'lobby';
    }
  } catch { /* private mode */ }
  const m = window.location.pathname.match(/\/(lobby|sandbox)(?:\/[^/]*)?\/?$/);
  return m ? m[1] : null;
}

// The sandbox game id from a /sandbox/<id> URL (or the 404.html stash).
// Null when there's no id (a bare /sandbox lands on the active game).
function readSandboxId() {
  try {
    const stashed = sessionStorage.getItem('hf-sandbox-redirect');
    if (stashed) {
      sessionStorage.removeItem('hf-sandbox-redirect');
      if (/^[0-9a-z]{3,16}$/.test(stashed)) return stashed;
    }
  } catch { /* private mode */ }
  const m = window.location.pathname.match(/\/sandbox\/([0-9a-z]{3,16})\/?$/);
  return m ? m[1] : null;
}

function readRoomCode() {
  let raw = null;
  try {
    const stashed = sessionStorage.getItem('hf-room-redirect');
    if (stashed) {
      sessionStorage.removeItem('hf-room-redirect');
      raw = stashed;
    }
  } catch { /* private mode */ }
  if (raw == null) {
    const pathMatch = window.location.pathname.match(/\/room\/([^/]+)\/?$/);
    if (pathMatch) raw = decodeURIComponent(pathMatch[1]);
  }
  if (raw == null) {
    const q = new URL(window.location.href).searchParams.get('room');
    if (q) raw = q;
  }
  return normaliseRoomCode(raw);
}

// A fresh page load (refresh, restored tab, WS-lost reconnect, or a
// version-bump reload) that carries a room code re-opens the lobby
// instead of dropping the player on the lobby list. Returns true on a
// successful openLobby (caller skips the lobby-list fallback).
async function maybeResumeRoomFromUrl() {
  const code = readRoomCode();
  if (!code) return false;
  try {
    const r = await getLobbyByCode(code);
    if (!r || !r.ok || !r.data || !r.data.id) {
      // Stale code (lobby cancelled or 404). openLobby would've
      // failed; just fall through to the lobby list. setRoomInUrl
      // isn't called so the URL naturally resets on the next nav.
      console.log('[hf:boot] room code stale/not found:', code);
      return false;
    }
    // openLobby calls setRoomInUrl on success, which rewrites the
    // address bar to /room/<CODE> (it was the app root after the
    // 404 redirect).
    // Arriving by room link: open the map looking at the player's
    // rocket (wins over the remembered viewport).
    requestRocketFocus();
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
  // Invite-link entry behaves like a room link: land on the rocket.
  requestRocketFocus();
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
  // Signal the inline boot watchdog (index.html) that the module graph
  // linked and main.js is executing. If a stale cached module or a
  // missing export breaks linking, main.js never runs, this stays unset,
  // and the watchdog shows the hard-refresh banner.
  window.__hfBooted = true;
  // Bring the on-device debug console (Eruda) back up if it was left enabled
  // in Config, so it's ready to capture early logs + failed server calls.
  initErudaFromPref();
  initSigninForm();
  initAccountMenu();
  initLobby({ onShowView: showView, onToast: toast });
  initInvites({ onToast: toast });
  // Surface ws give-up so CSS / a future status pill can read it.
  // The polling layers (lobby + game) already drive the data path
  // when WS is dead; this is just so we don't pretend WS is alive.
  ws.on('state', (s) => {
    document.body.classList.toggle('ws-down', !s.ready && !!s.giveUp);
    if (s.ready) document.body.classList.remove('ws-down');
    if (s.giveUp) {
      console.warn('[hf:ws] gave up on WebSocket - polling is the live path now');
    }
  });
  initBrowseButton();
  initMainMenu();
  initNewGameModal();
  onProfileChange(reflectProfile);

  await updateServerStatus();

  // A `?hf_discord=...` redirect from the Discord sign-in flow takes
  // precedence over the normal landing: it either signs the user in
  // (exchange the handoff for a token) or shows the name prompt. Either
  // way the landing below is skipped; the 30s status poll is still set.
  if (await maybeHandleDiscordAuth()) {
    setInterval(updateServerStatus, 30_000);
    return;
  }

  const me = await restoreProfile();
  reflectProfile(me);

  if (me) {
    console.log('[hf:boot] signed in as @' + me.name + ' (id=' + me.id + ')');
    ws.connect(me.token);
    subscribeInvitesForProfile(me);
    // Keep the multiplayer view populated for when the player switches.
    refreshLobbyList();
    refreshInvitesList();
    refreshDiscordLinkButton();
    // Landing priority: a `?invite=` URL wins; otherwise always land on
    // the lobby. Auto-resume is gone - a player can have several games
    // going at once, so jumping straight into one is presumptuous. Each
    // game has a Resume button in "Your games".
    const claimed = await maybeClaimInviteFromUrl();
    console.log('[hf:boot] inviteClaimed=', claimed);
    if (!claimed) {
      // Resolve the landing view from URL state. Priority: a stashed
      // room code (from 404.html /room/<CODE> bounce) wins; then a
      // /sandbox path / stash mounts solo; then /lobby (or any other
      // landing including root) falls through to the lobby list.
      const resumed = await maybeResumeRoomFromUrl();
      console.log('[hf:boot] roomResumed=', resumed);
      if (!resumed) {
        const landing = readLandingIntent();
        console.log('[hf:boot] landing intent =', landing);
        if (landing === 'sandbox') {
          // Land directly in the solo sandbox. If the URL names a specific
          // game (/sandbox/<id>), make it the live game first; otherwise
          // resume whatever sandbox game is active. mountBrowse({}) (no
          // newGame) keeps the restored state; showView writes the
          // /sandbox/<id> URL via setUrlForView.
          const sid = readSandboxId();
          // If the URL names a game that ISN'T the live one, switching it
          // in rewrites the live keys - but the state modules already read
          // localStorage at import time, so reload once to re-init from the
          // switched game. (Resume from "Your games" activates BEFORE
          // navigating, so there it's already live and this is a no-op.)
          if (sid && activateSandboxGame(sid)) {
            window.location.reload();
          } else {
            mountBrowse({});
            showView('view-browse');
          }
        } else {
          console.log('[hf:boot] landing on lobby (default)');
          showView('view-lobby-list');
        }
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
