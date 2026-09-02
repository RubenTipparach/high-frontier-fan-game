// Bootstrap and top-level UI coordination.

import { probeServer, apiAvailable, lookupInviteLink, claimInviteLink, getLobbyByCode,
  getNotifyPrefs, setNotifyPrefs, testNotify, startDiscordOauth, whoami,
  discordSignInEnabled, discordLoginStartUrl, discordExchange, discordSignup,
  ratFrontierAccess, testerAccess } from './api.js';
import {
  restoreProfile, activeProfile, signIn, signOut, mintDeviceCode,
  adoptServerSession, markDiscordLinked, onProfileChange,
} from './auth.js';
import { ws } from './ws.js';
import { isBatterySave, setBatterySave, applyBatterySaveClass } from './prefs.js';
import {
  initLobby, refreshLobbyList, openLobby, exitToLobbyList, createSoloRoom,
  pinGlobalChatBottom,
} from './lobby.js';
import {
  initInvites, refreshInvitesList, subscribeInvitesForProfile,
} from './invites.js';
import { mountBrowse, isBrowseOnline, refreshRoomOverlays, requestRocketFocus } from './game/browse.js';
import { mountRatFrontier } from './game/rat-frontier/rat-view.js';
import { currentSandboxId, activateSandboxGame } from './game/sandbox-games.js';
import { appBase } from './base.js';
import { initErudaFromPref } from './debug-console.js';
import { initUiScale } from './ui-scale.js';

const VIEWS = [
  'view-signin', 'view-lobby-list', 'view-create-lobby', 'view-lobby',
  'view-browse', 'view-rat-frontier',
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
    } else if (view === 'view-rat-frontier') {
      path = base + 'rat-frontier';
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
  // Re-entering the lobby list (e.g. the top-menu Lobby button) must snap the
  // global chat to the newest message: it mounts once, and a pin that ran while
  // the list was hidden landed on a 0-height box (stuck at top). Now that the
  // view is visible, re-pin to the bottom.
  if (id === 'view-lobby-list') pinGlobalChatBottom();
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

  // Battery saver toggle. Reflects + flips the calm/static display mode
  // (js/prefs.js); the renderer + animation paths read it live.
  const batteryBtn = document.getElementById('btn-battery-save');
  if (batteryBtn) {
    const syncBattery = () => {
      const on = isBatterySave();
      batteryBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      batteryBtn.classList.toggle('is-active', on);
      batteryBtn.textContent = on ? '🔋 Battery saver: On' : '🔋 Battery saver: Off';
    };
    batteryBtn.addEventListener('click', () => { setBatterySave(!isBatterySave()); syncBattery(); });
    syncBattery();
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
// Mirrors the server's isWebhookUrl (server/discord.js) so a typo is caught
// before the round-trip and the two never disagree on what a webhook looks like.
const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;
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
  const hookEl = document.getElementById('notify-webhook');
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
  if (hookEl) hookEl.value = d.webhookUrl || '';
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
  // A player's own channel webhook is independent of the bot: it needs no
  // linked account and works on a deployment with no bot at all. Show the
  // disclosure already open when one is saved, so it is not hidden state.
  const hooked = /^https:\/\//.test(d.webhookUrl || '');
  const hookWrap = document.getElementById('notify-webhook-wrap');
  if (hookWrap) hookWrap.open = hooked;
  // Test sends to every channel that is configured, so it needs either a
  // linked id (with a bot to send it) or a webhook.
  if (testBtn) testBtn.disabled = (off || !connected) && !hooked;

  for (const el of [idEl, hookEl, turnEl, aucEl,
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
    webhookUrl: (document.getElementById('notify-webhook')?.value || '').trim(),
    notifyTurn: !!document.getElementById('notify-turn')?.checked,
    notifyAuction: !!document.getElementById('notify-auction')?.checked,
  });

  // Save the event-kind checkboxes (OAuth block).
  document.getElementById('btn-notify-save')?.addEventListener('click', async () => {
    const me = activeProfile();
    if (!me) return;
    const prefs = collectPrefs();
    if (prefs.webhookUrl && !DISCORD_WEBHOOK_RE.test(prefs.webhookUrl)) {
      setStatus("That doesn't look like a Discord webhook URL.");
      return;
    }
    setStatus('Saving…');
    const r = await setNotifyPrefs(prefs, me.token);
    if (r.ok) { _notifyPrefs.webhookUrl = prefs.webhookUrl; await loadNotifySection(); setStatus('Saved.'); }
    else setStatus(`Couldn't save: ${r.error || 'error'}`);
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
      webhookUrl: (document.getElementById('notify-webhook')?.value || '').trim(),
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
    const hook = (document.getElementById('notify-webhook')?.value || '').trim();
    if (hook && !DISCORD_WEBHOOK_RE.test(hook)) {
      setStatus("That doesn't look like a Discord webhook URL.");
      return;
    }
    if (!/^\d{5,25}$/.test(id) && !hook) {
      setStatus('Connect Discord, enter a user ID, or paste a webhook URL first.');
      return;
    }
    setStatus('Sending test…');
    const r = await testNotify(id, me.token, undefined, hook);
    if (!r.ok) { setStatus(`Test failed: ${humanizeNotifyError(r.error)}`); return; }
    // Name where it landed, and say plainly when one channel refused it - a
    // half-delivered test that reads "sent" is how a bad webhook goes unnoticed.
    const sent = (r.data && r.data.sent) || [];
    const failed = (r.data && r.data.failed) || [];
    const label = { dm: 'a DM', webhook: 'your Discord channel' };
    const where = sent.map((k) => label[k] || k).join(' and ') || 'Discord';
    setStatus(failed.length
      ? `Test sent to ${where}, but ${failed.map((f) => label[f.via] || f.via).join(' and ')} failed.`
      : `Test sent to ${where} - go and look.`);
  });
}
function humanizeNotifyError(code) {
  return ({
    discord_disabled: 'this server has no notification bot configured.',
    oauth_disabled: 'one-click Discord linking isn\'t set up on this server.',
    bad_discord_id: 'that doesn\'t look like a Discord user ID.',
    bad_webhook_url: 'that doesn\'t look like a Discord webhook URL.',
    webhook_disabled: 'no webhook URL is saved.',
  })[code] || (code ? `couldn't reach you (${code}).` : 'unknown error.');
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
  const modeSection = document.getElementById('new-game-mode');
  const soloOpts = document.getElementById('new-game-solo-opts');
  const soloCreate = document.getElementById('btn-solo-create');
  const soloBack = document.getElementById('btn-solo-back');
  if (!trigger || !overlay || !closeBtn || !mpBtn || !soloBtn) return;
  // Solo setup: Draft start, Random draft and V1 Quick Start are mutually
  // exclusive (one opening or none), so checking one clears the others.
  const soloOpenings = ['solo-draft', 'solo-random-draft', 'solo-quick-start']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  for (const box of soloOpenings) {
    box.addEventListener('change', () => {
      if (!box.checked) return;
      for (const other of soloOpenings) if (other !== box) other.checked = false;
    });
  }
  // Reset to the mode chooser (hide the sub-steps).
  const showMode = () => {
    if (modeSection) modeSection.classList.remove('hidden');
    if (soloOpts) soloOpts.classList.add('hidden');
  };
  const open = () => {
    showMode();
    // Re-check Rat Frontier + tester access each open so a freshly-linked
    // admin/tester or a just-deployed server reveals the entry without a full
    // reload.
    refreshRatAccess(activeProfile());
    refreshTesterAccess(activeProfile());
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
  // Admin-gated Rat Frontier variant. The row is revealed only when the
  // server confirms this profile is on the allowlist (see refreshRatAccess).
  const ratBtn = document.getElementById('btn-new-game-rat');
  if (ratBtn) ratBtn.addEventListener('click', () => {
    close();
    openRatFrontier();
  });
  // Solo room: pick the sandbox-style options first (starting bank + card
  // economy), then create + start a private 1-player server game.
  // Each optional module adds patent decks, so the STANDARD starting bank grows
  // by ~$1 per deck: M1 adds two decks (+2), M2 adds one (the Bernals, +1).
  // Reflect the combined bonus live on the "standard" aqua option + the draft
  // "opens at N" text whenever Module 1 OR Module 2 is toggled, so the display
  // tracks the number of module decks selected. Free play keeps its round
  // number; the server folds the same bonuses into its default bank (state.js
  // M1_AQUA_BONUS / M2_AQUA_BONUS) so the two never drift.
  const M1_AQUA_BONUS = 2;
  const M2_AQUA_BONUS = 1;
  const refreshSoloAqua = () => {
    const bonus = (document.getElementById('solo-m1')?.checked ? M1_AQUA_BONUS : 0)
      + (document.getElementById('solo-m2')?.checked ? M2_AQUA_BONUS : 0);
    const stdBtn = soloOpts && soloOpts.querySelector('.solo-opt[data-aqua-base]');
    if (stdBtn) {
      const base = Number(stdBtn.dataset.aquaBase) || 6;
      stdBtn.dataset.aqua = String(base + bonus);
      stdBtn.textContent = `${base + bonus} (standard)`;
    }
    document.querySelectorAll('.solo-bank-n').forEach((el) => { el.textContent = String(6 + bonus); });
  };
  document.getElementById('solo-m1')?.addEventListener('change', refreshSoloAqua);
  document.getElementById('solo-m2')?.addEventListener('change', refreshSoloAqua);
  soloBtn.addEventListener('click', () => {
    if (modeSection) modeSection.classList.add('hidden');
    if (soloOpts) soloOpts.classList.remove('hidden');
    // Default the solo wizard to the Sandbox path each open (a prior CEO
    // selection must not leave the option groups locked).
    soloOpts?.querySelectorAll('.solo-opt[data-solomode]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.solomode === 'sandbox');
    });
    applySoloMode('sandbox');
    refreshSoloAqua();
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
  // Solo/CEO Module 2 + game length, aligned with the multiplayer room: M0 is
  // mandatory for M2 (checking M2 checks M0), and Futures are the 7-round long
  // game - so with M2 on, the sub-5 (4-round) button is disabled, the length
  // defaults to 7, and 5 / 6 warn that they run colonization without Futures.
  const soloM2cb = document.getElementById('solo-m2');
  const soloM0cb = document.getElementById('solo-m0');
  const soloRoundsGroup = soloOpts && soloOpts.querySelector('.solo-opt-group[data-opt="rounds"]');
  let soloRoundsWarn = null;
  if (soloRoundsGroup) {
    soloRoundsWarn = document.createElement('p');
    soloRoundsWarn.className = 'module-round-warn hidden';
    soloRoundsGroup.appendChild(soloRoundsWarn);
  }
  const applySoloRoundRule = (justToggled) => {
    if (!soloRoundsGroup) return;
    const on = !!(soloM2cb && soloM2cb.checked);
    const btns = [...soloRoundsGroup.querySelectorAll('.solo-opt[data-rounds]')];
    for (const b of btns) if (Number(b.dataset.rounds) < 5) b.disabled = on;
    const activeNow = soloRoundsGroup.querySelector('.solo-opt.is-active[data-rounds]');
    const activeR = activeNow ? Number(activeNow.dataset.rounds) : 0;
    if (on && (justToggled || activeR < 5)) {
      const seven = btns.find((b) => Number(b.dataset.rounds) === 7);
      if (seven) { btns.forEach((b) => b.classList.remove('is-active')); seven.classList.add('is-active'); }
    }
    if (soloRoundsWarn) {
      const act = soloRoundsGroup.querySelector('.solo-opt.is-active[data-rounds]');
      const r = act ? Number(act.dataset.rounds) : 0;
      const warn = on && (r === 5 || r === 6);
      soloRoundsWarn.textContent = warn
        ? 'Heads up: 5 and 6 round games do not include Futures (colonization only). Choose 7 for the full Futures game.'
        : '';
      soloRoundsWarn.classList.toggle('hidden', !warn);
    }
  };
  if (soloM2cb) {
    soloM2cb.addEventListener('change', () => {
      // M2 requires M0, so checking M2 checks M0 - EXCEPT under V9 The Sirens,
      // which excludes Module 0 as an opt-in. The server turns the Assembly on
      // for M2 itself, so the box must stay clear or the room is refused
      // (sirens_excludes_m0). (User 2026-08-01.)
      const sirensOn = !!soloOpts?.querySelector('.solo-opt[data-solomode="sirens"].is-active');
      if (soloM2cb.checked && soloM0cb && !sirensOn) soloM0cb.checked = true;
      applySoloRoundRule(true);
    });
  }
  if (soloRoundsGroup) {
    soloRoundsGroup.querySelectorAll('.solo-opt[data-rounds]').forEach((b) => {
      b.addEventListener('click', () => applySoloRoundRule(false));
    });
  }
  // CEO Solitaire is its own solo category (released v1.2.0). Selecting it FIXES
  // the variant's setup: the sandbox option groups (aqua / cards / length /
  // house rules) are locked, Module 0 is auto-checked and locked (mandatory),
  // and only the optional company modules (M1 / M2 / M4) stay live. The
  // #solo-mode-group itself is admin-gated (setAdminModuleRows), so a non-admin
  // never sees the CEO button and always runs the sandbox path.
  const applySoloMode = (mode) => {
    const ceo = mode === 'ceo';
    const tutorial = mode === 'tutorial';
    // V5 Hermes Fall and V9 The Sirens fix their own setup, so the sandbox
    // knobs that no longer mean anything are HIDDEN rather than shown greyed
    // (user 2026-07-31). Both scenarios set the starting bank and the card
    // economy; Hermes additionally FIXES the length at 2 Solar Cycles (the two
    // seniority disks are the whole shape of the mission), so its length is not
    // a choice either. Sirens keeps its length picker - 4 / 5 / 7 are all legal
    // there - but drops the 6 the variant does not allow.
    const hermes = mode === 'hermes';
    const sirens = mode === 'sirens';
    // V4 Altruism fixes its setup too (user 2026-08-11): the STANDARD bank and
    // the card MARKET, because its victory targets are set against the real
    // economy - a free-play bank or the Free Library would score against a
    // different game. Length stays a choice, but only 4 / 5 / 7.
    const altruism = mode === 'altruism';
    const scenario = hermes || sirens || altruism;
    // Tutorial is its OWN menu (the difficulty tiers), NOT the sandbox options.
    // Rather than grey the regular controls, hide them and show the tier panel;
    // the Back button stays so the player can return to the mode chooser.
    document.getElementById('solo-tutorial-opts')?.classList.toggle('hidden', !tutorial);
    const hideGroup = {
      name: tutorial,
      aqua: tutorial || scenario,
      econ: tutorial || scenario,
      rounds: tutorial || hermes,
      expansions: tutorial,
      // V5 Hermes Fall sets its own opening (half decks, the Mass Driver seeded
      // near the top of the thrusters), so the house-rule openings go with the
      // rest of the setup it takes over. (User 2026-07-31.)
      rules: tutorial || hermes,
    };
    Object.entries(hideGroup).forEach(([opt, hide]) => {
      soloOpts?.querySelector(`.solo-opt-group[data-opt="${opt}"]`)?.classList.toggle('hidden', hide);
    });
    // The Free Library / Card Market explainer belongs to the econ group, so it
    // goes wherever that group goes.
    soloOpts?.querySelectorAll('.js-solo-std-note').forEach((n) => n.classList.toggle('hidden', tutorial || scenario));
    // Sirens runs 4, 5 or 7 Solar Cycles. The 6 is DISABLED rather than hidden
    // - hiding it would reflow the row, and the button count in these groups
    // must not move (see the grid note in css/style.css) - and a stale 6 moves
    // to 5 so the form never submits a length the table would be refused for.
    const roundsGroup = soloOpts && soloOpts.querySelector('.solo-opt-group[data-opt="rounds"]');
    const six = roundsGroup && roundsGroup.querySelector('.solo-opt[data-rounds="6"]');
    if (six) {
      six.disabled = sirens || altruism;
      if ((sirens || altruism) && six.classList.contains('is-active')) {
        six.classList.remove('is-active');
        roundsGroup.querySelector('.solo-opt[data-rounds="5"]')?.classList.add('is-active');
      }
    }
    if (soloCreate) soloCreate.classList.toggle('hidden', tutorial);
    if (soloOpts) soloOpts.classList.toggle('ceo-mode', ceo);
    // Lock the variant-fixed groups: starting aqua, card economy, and house
    // rules. Game length (rounds) stays SELECTABLE - in CEO Solitaire it sets
    // the short-vs-long game (the seniority-disk count), so the player chooses
    // it. Dim the locked groups (CSS .is-locked) AND hard-disable every control
    // inside so the lock holds even if the dimming style is missing -
    // pointer-events alone is not enough (a button stays keyboard-focusable).
    ['aqua', 'econ', 'rules'].forEach((opt) => {
      const g = soloOpts && soloOpts.querySelector(`.solo-opt-group[data-opt="${opt}"]`);
      if (!g) return;
      g.classList.toggle('is-locked', ceo);
      g.querySelectorAll('button, input').forEach((el) => { el.disabled = ceo; });
    });
    // CEO Solitaire and V5 Hermes Fall each fix their own setup, so a house rule
    // (draft start / random draft / V1 Quick Start) selected BEFORE picking one
    // must be CLEARED, not just hidden - otherwise the stale checkbox is still
    // submitted and leaks into the game. (The server also forces these off for
    // both.)
    if (ceo || hermes) {
      for (const id of ['solo-draft', 'solo-random-draft', 'solo-quick-start']) {
        const cb = document.getElementById(id);
        if (cb) cb.checked = false;
      }
    }
    // CEO Solitaire runs the card MARKET (decks + Research Auction / Free
    // Market), never the Free Library. Force the Card Market choice visible in
    // the locked econ group so the display matches what actually starts.
    if (ceo) {
      const econGroup = soloOpts && soloOpts.querySelector('.solo-opt-group[data-opt="econ"]');
      econGroup?.querySelectorAll('.solo-opt[data-econ]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.econ === 'market');
      });
      // Standard starting bank (setup as per Altruism V4b), not the free-play
      // bank. Show the "standard" aqua option active in the locked group so the
      // display matches; the server recomputes the exact standard + module bank.
      const aquaGroup = soloOpts && soloOpts.querySelector('.solo-opt-group[data-opt="aqua"]');
      aquaGroup?.querySelectorAll('.solo-opt[data-aqua]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.aquaBase != null);
      });
    }
    // Module 0 is mandatory for CEO Solitaire: check + lock it. Sirens is the
    // opposite - the Sol Political Assembly has no place in the Uranian
    // system, so M0 is cleared and locked OFF rather than left checked for a
    // room the table would be refused. Sandbox mode restores the unlocked,
    // host-controlled checkbox.
    const m0cb = document.getElementById('solo-m0');
    if (m0cb) {
      if (ceo) { m0cb.checked = true; m0cb.disabled = true; }
      else if (sirens) { m0cb.checked = false; m0cb.disabled = true; }
      else { m0cb.disabled = false; }
    }
    // V5 Hermes Fall may take Module 0, and at one seat it runs the SOLITAIRE
    // Assembly (4G3) - the same law set CEO Solitaire uses, where every ideology
    // still means something to a single player. Say so on the row, because
    // "Module 0: Politics" would otherwise promise the multiplayer laws. Offered
    // here only: the multiplayer create form locks the row off for Hermes.
    const m0text = document.getElementById('solo-m0-text');
    if (m0text) {
      m0text.innerHTML = (hermes || ceo)
        ? '<strong>Module 0: Politics</strong> - adds the Solitaire Sol Political Assembly'
        : '<strong>Module 0: Politics</strong> - adds the Sol Political Assembly';
    }
    // One short note per scenario, so a host reading the picker knows what the
    // mission IS before they start it. Module 4 (Exodus) is a long way off, so
    // its row stays hidden for now (it keeps its `hidden` class in the markup;
    // nothing reveals it).
    document.getElementById('solo-ceo-note')?.classList.toggle('hidden', !ceo);
    document.getElementById('solo-hermes-note')?.classList.toggle('hidden', !hermes);
    document.getElementById('solo-sirens-note')?.classList.toggle('hidden', !sirens);
    document.getElementById('solo-altruism-note')?.classList.toggle('hidden', !altruism);
    // The create button names the variant so the player knows what starts.
    if (soloCreate) {
      soloCreate.textContent = ceo ? '👔 Begin CEO Solitaire'
        : hermes ? '☄️ Begin Hermes Fall'
        : sirens ? '🌊 Begin The Sirens'
        : altruism ? '🤝 Begin Altruism'
        : '🧪 Create solo room';
    }
  };
  soloOpts?.querySelectorAll('.solo-opt[data-solomode]').forEach((btn) => {
    btn.addEventListener('click', () => applySoloMode(btn.dataset.solomode));
  });
  // Tutorial tiers. Basic is the live path; Advanced + Experienced are a preview
  // of later releases (disabled in the markup). The guided tutorial engine is
  // still being built, so Basic previews what is coming rather than launching yet.
  soloOpts?.querySelectorAll('.tutorial-tier[data-tut]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled || btn.dataset.tut !== 'basic') return;
      btn.disabled = true;
      const prev = btn.querySelector('.tut-name')?.textContent;
      const nameEl = btn.querySelector('.tut-name');
      if (nameEl) nameEl.textContent = '🚀 Starting…';
      try {
        const r = await createSoloRoom({ tutorial: true, name: 'Tutorial' });
        if (r && r.ok) { close(); }
        else { toast('Could not start the tutorial: ' + ((r && r.error) || 'network'), 'error'); }
      } catch (err) {
        console.error('tutorial:', err);
        toast('Could not start the tutorial.', 'error');
      } finally {
        btn.disabled = false;
        if (nameEl && prev) nameEl.textContent = prev;
      }
    });
  });
  if (soloBack) soloBack.addEventListener('click', showMode);
  if (soloCreate) soloCreate.addEventListener('click', async () => {
    const aquaBtn = soloOpts && soloOpts.querySelector('.solo-opt.is-active[data-aqua]');
    const econBtn = soloOpts && soloOpts.querySelector('.solo-opt.is-active[data-econ]');
    const roundsBtn = soloOpts && soloOpts.querySelector('.solo-opt.is-active[data-rounds]');
    // CEO Solitaire: released category (v1.2.0), shown to every host. The
    // server enforces the gate, so reading the active toggle is enough.
    const ceoSolo = !!soloOpts?.querySelector('.solo-opt[data-solomode="ceo"].is-active');
    // The solo-type group is single-choice, so at most one of these is ever
    // true and the server's one-variant rule is satisfied structurally.
    const hermes = !!soloOpts?.querySelector('.solo-opt[data-solomode="hermes"].is-active');
    const sirens = !!soloOpts?.querySelector('.solo-opt[data-solomode="sirens"].is-active');
    const altruism = !!soloOpts?.querySelector('.solo-opt[data-solomode="altruism"].is-active');
    // The scenarios set their own bank + card economy, and their controls are
    // HIDDEN rather than locked, so whatever was last picked in sandbox mode
    // must not ride along: send the standard setup instead.
    const scenario = hermes || sirens || altruism;
    const startingAqua = (ceoSolo || scenario) ? 6 : (aquaBtn ? Number(aquaBtn.dataset.aqua) : 100);
    // CEO Solitaire always runs the card MARKET (the server forces this too); the
    // locked econ control must not submit Free Library and kill the auction. The
    // two scenarios run the market for the same reason - they have auction rules.
    const economy = (ceoSolo || scenario) ? 'market' : (econBtn ? econBtn.dataset.econ : 'library');
    // Hermes has no length to submit - it is fixed at 2 Solar Cycles and the
    // server clamps the room to that, which is why its picker is hidden.
    const maxRounds = roundsBtn ? Number(roundsBtn.dataset.rounds) : 5;
    const draftStart = !!document.getElementById('solo-draft')?.checked;
    const randomDraft = !!document.getElementById('solo-random-draft')?.checked;
    // V1 Quick Start does not compose with CEO Solitaire (the variant runs its
    // own board-meeting clock), so the option is dropped for a CEO room.
    const quickStart = !ceoSolo && !!document.getElementById('solo-quick-start')?.checked;
    const m0 = !!document.getElementById('solo-m0')?.checked;
    // M1 + M2 are both open for playtesting (M2 released v1.3.0); a ceoSolo room
    // still runs without M2 (the server forces it off).
    const m1 = !!document.getElementById('solo-m1')?.checked;
    const m2 = !!document.getElementById('solo-m2')?.checked;
    const name = document.getElementById('solo-name')?.value || '';
    soloCreate.disabled = true;
    const prev = soloCreate.textContent;
    soloCreate.textContent = 'Creating room…';
    try {
      const r = await createSoloRoom({ name, startingAqua, economy, maxRounds, draftStart, randomDraft, quickStart, m0, m1, m2, ceoSolo, hermes, sirens, altruism });
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
}

// Mount the admin-gated Rat Frontier surface (card catalog + Alpha
// Centauri map) into its view and switch to it.
function openRatFrontier() {
  const host = document.getElementById('view-rat-frontier');
  if (!host) return;
  showView('view-rat-frontier');
  mountRatFrontier(host, { onBack: () => showView(_prevView || 'view-lobby-list') });
}

// Reveal or hide the Rat Frontier menu row based on whether the current
// profile is on the server's secret allowlist. Called on every profile
// change; fails closed (hidden) when signed out or the server says no.
// Admin names from the client config meta tag (soft, static-site gate).
function ratAdminsFromConfig() {
  const el = document.querySelector('meta[name="hf-rat-admins"]');
  return new Set((el?.content || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
let _ratAccessReqId = 0;
let _testerAccessReqId = 0;
// The two independent signals that gate the experimental-variant rows (V9
// Sirens, V5 Hermes): admin access (Rat Frontier's own gate) OR the
// admin-curated tester allowlist. Either one alone is enough, so the rows are
// resynced from BOTH caches whenever either check resolves - see
// syncVariantRows. Each starts false (fail closed), matching "hidden when
// signed out" everywhere else in this file.
let _adminAllowedCache = false;
let _testerAllowedCache = false;
// Separate from the two above: is this player actually ON the tester list, as
// opposed to reaching the same scenarios by being an admin? Only the real
// article gets the lobby's alpha-tester banner.
let _isTesterCache = false;

// The lobby's alpha-tester banner. Hidden by default and for everyone who is
// not on the list, so a signed-out or ordinary player never sees it flash
// during boot.
function syncAlphaBanner() {
  const el = document.getElementById('alpha-tester-banner');
  if (el) el.classList.toggle('hidden', !_isTesterCache);
}

// Reveal module toggles. M1 (Terawatt) and M2 (Colonization + Futures) are both
// open for playtesting now (M2 released v1.3.0, the M1 open-release pattern), so
// their room-creation checkboxes show for every host. Kept as a function (the
// `allowed` arg is ignored for these released rows) so a future admin-only
// module can slot back in.
function setAdminModuleRows(allowed) {   // eslint-disable-line no-unused-vars
  for (const id of ['create-m2-row', 'solo-m2-row']) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }
  // CEO Solitaire (V6) is RELEASED (v1.2.0): the solo-type toggle shows for
  // every host, so it no longer rides the admin reveal here (see the
  // unconditional un-hide in the solo wizard setup).
  // The guided Tutorial is PUBLIC now (user 2026-07-10): the solo-type button
  // shows for every host, like CEO Solitaire. It was admin-only during testing.
  const tut = document.getElementById('solo-mode-tutorial');
  if (tut) tut.classList.remove('hidden');
}

// Published VARIANTS (docs/variants-tracker.md): gated to admins AND the
// tester allowlist while they get more testing (user 2026-07-30, tester gate
// added shortly after the admin-only one). The create form's Scenario group
// and the solo wizard's Hermes/Sirens buttons toggle on admin-OR-tester,
// re-synced every time either signal resolves. The server forces both flags
// off for anyone who is neither, regardless of what the client sends, so this
// is only the UI half of the gate.
function syncVariantRows() {
  const allowed = _adminAllowedCache || _testerAllowedCache;
  // V5 Hermes Fall is RELEASED (user 2026-08-07), so the scenario GROUP is open
  // to every host and only the still-in-testing entries inside it are hidden.
  // The group used to be hidden wholesale, which would have taken released
  // Hermes down with unreleased Sirens.
  const variants = document.getElementById('create-variants-group');
  if (variants) variants.classList.remove('hidden');
  const label = variants && variants.querySelector('.solo-opt-label');
  if (label) label.textContent = allowed ? 'Scenario (in testing)' : 'Scenario';
  // Per-entry gating: a released scenario always shows, one still in testing
  // rides the admin / tester signal. Add a row here when a scenario releases.
  for (const el of (variants ? variants.querySelectorAll('[data-variant]') : [])) {
    const v = el.getAttribute('data-variant');
    if (v === 'sirens') el.classList.toggle('hidden', !allowed);
  }
  // The solo wizard's scenario entries mirror the same per-entry rule. They live
  // in the existing single-choice "Solo type" group, so picking one automatically
  // deselects CEO Solitaire / Tutorial - which is the whole point: a table runs
  // at most one scenario.
  document.getElementById('solo-mode-hermes')?.classList.remove('hidden');
  document.getElementById('solo-mode-altruism')?.classList.remove('hidden');
  document.getElementById('solo-mode-sirens')?.classList.toggle('hidden', !allowed);
}

async function refreshRatAccess(profile) {
  const row = document.getElementById('new-game-rat-row');
  const reqId = ++_ratAccessReqId;
  const apply = (allowed) => {
    _adminAllowedCache = allowed;
    if (row) row.classList.toggle('hidden', !allowed);
    setAdminModuleRows(allowed);
    syncVariantRows();
  };
  if (!profile) { apply(false); return; }
  // Server-derived admin flag from /profiles/me (set on page load): the
  // authoritative, page-load answer. Reveal immediately when it's true.
  if (profile.isAdmin) { apply(true); return; }
  // Client-config allowlist reveals the entry immediately (no round-trip).
  const name = String(profile.name || '').toLowerCase();
  if (name && ratAdminsFromConfig().has(name)) { apply(true); return; }
  // Otherwise fall back to the server's real check (the authoritative gate).
  if (!profile.token || !apiAvailable()) { apply(false); return; }
  let allowed = false;
  try {
    const r = await ratFrontierAccess(profile.token);
    allowed = !!(r && r.ok && r.data && r.data.allowed);
  } catch { allowed = false; }
  if (reqId !== _ratAccessReqId) return;   // a newer profile change superseded us
  apply(allowed);
}

// The tester half of the variant-row gate. No name/meta fast path (there is no
// static tester list to check client-side, unlike the Rat Frontier admin
// allowlist) - always the server round trip. Same fail-closed default as
// refreshRatAccess when signed out or the request can't be made.
async function refreshTesterAccess(profile) {
  const reqId = ++_testerAccessReqId;
  // `allowed` gates the variant rows (admin OR tester); `tester` is the
  // narrower "you are on the list" answer that the banner speaks to.
  const apply = (allowed, tester) => {
    _testerAllowedCache = allowed;
    _isTesterCache = tester;
    syncVariantRows();
    syncAlphaBanner();
  };
  if (!profile || !profile.token || !apiAvailable()) { apply(false, false); return; }
  let allowed = false;
  let tester = false;
  try {
    const r = await testerAccess(profile.token);
    allowed = !!(r && r.ok && r.data && r.data.allowed);
    tester = !!(r && r.ok && r.data && r.data.tester);
  } catch { allowed = false; tester = false; }
  if (reqId !== _testerAccessReqId) return;   // a newer profile change superseded us
  apply(allowed, tester);
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
      if (stashed === 'rat-frontier') return 'rat-frontier';
    }
  } catch { /* private mode */ }
  const m = window.location.pathname.match(/\/(lobby|sandbox|rat-frontier)(?:\/[^/]*)?\/?$/);
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
// Survives a sign-in round-trip (e.g. the Discord OAuth redirect drops the
// query string) so an invited, signed-out player still lands in the room.
const PENDING_INVITE_KEY = 'hf-pending-invite';

async function maybeClaimInviteFromUrl() {
  const url = new URL(window.location.href);
  let code = url.searchParams.get('invite');
  if (code) {
    // Clear from the URL so a refresh doesn't double-claim.
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
  // Fall back to a code stashed before a sign-in round-trip. The Discord OAuth
  // hop navigates away and returns with a fresh `?hf_discord=...` URL, dropping
  // the original `?invite=`, so we persist the invite in sessionStorage (which
  // survives the same-tab round-trip) and recover it here once signed in.
  if (!code) {
    try { code = sessionStorage.getItem(PENDING_INVITE_KEY) || null; } catch { /* private mode */ }
  }
  if (!code) return false;
  const me = activeProfile();
  if (!me) {
    // Not signed in yet: remember the invite so we can claim it the instant
    // sign-in finishes (afterSignIn calls this again). Then send them to sign
    // in - Discord or otherwise.
    try { sessionStorage.setItem(PENDING_INVITE_KEY, code); } catch { /* private mode */ }
    toast('Sign in to join the game you were invited to.', 'invite');
    return false;
  }
  // We have both a code and a session - this is the claim, so drop the stash
  // whatever the outcome (a bad / expired link shouldn't keep retrying).
  try { sessionStorage.removeItem(PENDING_INVITE_KEY); } catch { /* private mode */ }
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
  // Apply the saved (or OS-default) battery-saver state before the map mounts.
  applyBatterySaveClass();
  // UI scale: on very wide viewports (a 4K monitor at 100% OS scaling) zoom
  // the interface so it reads like a 1920-wide layout. Before the map mounts,
  // so the renderer sizes its canvas against the final geometry.
  initUiScale();
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
  onProfileChange(refreshRatAccess);
  onProfileChange(refreshTesterAccess);
  refreshRatAccess(activeProfile());
  refreshTesterAccess(activeProfile());

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
  // Verify Rat Frontier (admin) + tester access against the server on page
  // load, once the profile is restored.
  refreshRatAccess(me);
  refreshTesterAccess(me);

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
        } else if (landing === 'rat-frontier') {
          // Direct /rat-frontier load (or a version-reload that kept the
          // path). Admins re-open the variant; anyone else lands on the lobby.
          if (activeProfile() && activeProfile().isAdmin) {
            console.log('[hf:boot] landing on rat-frontier');
            openRatFrontier();
          } else {
            showView('view-lobby-list');
          }
        } else {
          console.log('[hf:boot] landing on lobby (default)');
          showView('view-lobby-list');
        }
      }
    }
  } else {
    console.log('[hf:boot] no profile - going to signin');
    // Read the invite BEFORE showView - showView('view-signin') rewrites the
    // URL to the app root (setUrlForView), which would drop the ?invite=.
    // Stashing it here lets it survive the sign-in round-trip (the Discord
    // OAuth redirect also drops the query string) so it gets claimed the
    // instant sign-in finishes - that's what drops the player into the room
    // they were invited to. The lobby-name toast tells them where they're off to.
    const inviteCode = new URL(window.location.href).searchParams.get('invite');
    showView('view-signin');
    if (inviteCode) {
      try { sessionStorage.setItem(PENDING_INVITE_KEY, inviteCode); } catch { /* private mode */ }
      const peek = await lookupInviteLink(inviteCode);
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
