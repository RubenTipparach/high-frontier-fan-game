# Discord turn notifications - setup

The game can DM a player on Discord when it's their turn (or when an
auction needs them). This is **opt-in per player** and **inert until you
configure a bot**, so a deployment with no bot behaves exactly as before.

There are two ways a player links their Discord account:

- **Connect Discord (one click, recommended).** The player clicks
  **Connect Discord** in the menu, approves once on Discord, and they're
  done. Behind the scenes the server reads their account (`identify`) and
  silently adds them to the bot's server (`guilds.join`) so the bot is
  allowed to DM them. The player never copies an ID and never manually
  joins a server. Requires the OAuth setup in section 2 below.
- **Manual user ID (fallback).** The player pastes their Discord user ID.
  Works with only a bot token configured, but they must already share a
  server with the bot (see the note below).

> **Why the shared server matters.** Discord only delivers a bot DM if the
> bot **shares a server** with the user (and the user allows DMs from
> server members). This is a Discord anti-spam rule - there is no way for
> a bot to DM someone it has no mutual server with. The one-click flow
> exists precisely to satisfy this automatically: `guilds.join` adds the
> player to the bot's server for them, so they never have to think about
> it.

---

## 1. Create the bot (once)

1. Go to the Discord Developer Portal: https://discord.com/developers/applications
2. **New Application** -> name it (e.g. "High Frontier").
3. Open the **Bot** tab -> **Add Bot**.
4. Under **Token**, click **Reset Token** and copy it. Treat it like a
   password - this is your `DISCORD_BOT_TOKEN`.
5. No privileged gateway intents are required (we only send DMs and add
   members over REST), so you can leave Message Content / Presence /
   Server Members **off**.

This token alone enables the **manual user-ID** path. For the one-click
**Connect Discord** button, also do section 2.

## 2. Set up one-click "Connect Discord" (OAuth + auto-join)

This is what makes the player experience a single click. It needs an
OAuth client secret, a redirect URL, and one server (a "guild") the bot
lives in so players can be auto-added to it.

### 2a. Make the bot's guild

1. In Discord, **create a server** (the `+` in the server rail). It can be
   empty and private - players never have to open or use it; it exists
   only to satisfy Discord's mutual-server rule. Name it anything (e.g.
   "High Frontier notifications").
2. Add **your bot** to it: Developer Portal -> your app -> **OAuth2** ->
   **URL Generator** -> scope **`bot`** -> (no extra permissions needed) ->
   copy the URL, open it, pick the server you just made, **Authorize**.
3. Get the server's ID: in Discord enable **User Settings -> Advanced ->
   Developer Mode**, then right-click the server icon -> **Copy Server ID**.
   That number is your `DISCORD_GUILD_ID`.

> The bot must be able to add members to this guild. Because you created
> the server (you're the owner) and the bot joined via the `bot` scope,
> it already can. Don't restrict the bot's role below the default.

### 2b. Get the OAuth client credentials

1. Developer Portal -> your app -> **OAuth2** -> **General**.
2. Copy the **Client ID** -> this is `DISCORD_CLIENT_ID` (it's public).
3. Click **Reset Secret**, copy it -> this is `DISCORD_CLIENT_SECRET`
   (treat like a password).

### 2c. Register the redirect URL

Still under **OAuth2 -> General -> Redirects**, click **Add Redirect** and
enter the callback URL on your API host, exactly:

```
https://high-frontier-fan-game.fly.dev/auth/discord/callback
```

(For local dev also add `http://localhost:8080/auth/discord/callback`.)
This must match byte-for-byte. **Save Changes.**

By default the server derives the redirect from the incoming request host.
If your app sits behind a proxy that rewrites the host, set
`DISCORD_REDIRECT_URI` explicitly to the value above so the authorize
request, the token exchange, and the portal all agree.

## 3. Give the API the secrets

The server reads these from the environment:

| Variable | Required for | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | DMs (both paths) | from section 1 |
| `DISCORD_CLIENT_ID` | Connect Discord | public app id |
| `DISCORD_CLIENT_SECRET` | Connect Discord | secret |
| `DISCORD_GUILD_ID` | Connect Discord | the bot's server (2a) |
| `DISCORD_REDIRECT_URI` | optional | only if behind a host-rewriting proxy |

**Fly.io (production):**
```
fly secrets set \
  DISCORD_BOT_TOKEN=your-bot-token \
  DISCORD_CLIENT_ID=your-client-id \
  DISCORD_CLIENT_SECRET=your-client-secret \
  DISCORD_GUILD_ID=your-guild-id
```
This restarts the app with the secrets available. `server/discord.js`
picks them up at boot: `discordEnabled()` flips on with the token, and
`oauthEnabled()` flips on once client id + secret + guild id are all set.

> CI note: `DISCORD_BOT_TOKEN` (and the others) can also be stored as
> GitHub Actions secrets; the deploy workflow stages them to Fly before
> deploying. See `.github/workflows/deploy.yml`.

**Local dev:**
```
cd server
DISCORD_BOT_TOKEN=... DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... \
DISCORD_GUILD_ID=... DATABASE_PATH=./hf-dev.db npm run dev
```

With nothing set, the notify endpoints are dormant (`discord_disabled`).
With only the bot token, the manual user-ID path works. With all four,
the one-click button appears.

## 4. Each player links their account (in the app)

Open the **menu (top-left ☰) -> Turn notifications**, then either:

- **Connect Discord** (if the server has OAuth set up): click it, approve
  in the Discord popup, and the button flips to "connected". Click
  **Send test DM** to confirm. Choose which events you want and
  **Save preferences**.
- **Link manually with a user ID** (the disclosure below the button):
  enable Developer Mode in Discord, right-click your name, **Copy User
  ID**, paste it, **Save ID**. You must already share a server with the
  bot for the test DM to arrive.

---

## What triggers a DM

- **Your turn starts** - when `END_TURN` advances the active seat to you.
- **An auction needs you** - when an auction opens, every player except
  the auctioneer is pinged.

One event = one DM, so there's no extra throttling to configure.

## Privacy / security notes

- The only thing stored is the player's Discord **user ID** (a public
  snowflake), in the `notify_prefs` table, opt-in. Clearing it in settings
  removes notifications for that player.
- The **bot token** and **client secret** live only in the server
  environment (Fly secrets). Never commit them. If either leaks, reset it
  in the Developer Portal.
- OAuth requests only `identify` + `guilds.join`. The app never reads
  messages, never sees your other servers, and the access token is used
  once (read your id, add you to the bot's guild) and discarded - it is
  not stored.

## Troubleshooting

- **"no mutual guilds" / send 403 (code 50278)** on a manual-ID test - the
  bot can't DM you because you share no server with it. Use **Connect
  Discord** (which auto-joins you), or manually join the bot's server and
  enable **Server Settings -> Privacy -> Allow direct messages**.
- **"Link expired"** on the callback page - the one-time state token
  expired (10 min) or was already used. Reopen the menu and click Connect
  again.
- **"Connection failed (token 400 ... invalid_client)"** - the
  `DISCORD_CLIENT_SECRET` is wrong or the redirect URL doesn't match the
  portal. Re-check sections 2b/2c.
- **"redirect_uri mismatch"** on Discord's own page - the registered
  redirect (2c) doesn't byte-match what the server sent; set
  `DISCORD_REDIRECT_URI` to the exact registered value.
- **Popup didn't open** - allow popups for the site and click Connect
  again.
- **"one-click Discord linking isn't set up"** - `oauthEnabled()` is false;
  one of `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_GUILD_ID`
  is missing. The manual path still works.
- Still stuck? Check the API logs (`fly logs`) for `[notify]` lines - the
  Discord HTTP status is included.

---

# Channel webhook (no bot)

A second, simpler path: a Discord **channel webhook** posts turn / auction
events to one channel for the whole deployment. No bot, no token, no
per-player linking - just a URL. The two paths are independent: you can run
either, both, or neither.

## Set it up

1. In Discord: open the target channel -> **Edit Channel** ->
   **Integrations** -> **Webhooks** -> **New Webhook** -> **Copy Webhook
   URL**. (It looks like
   `https://discord.com/api/webhooks/<id>/<token>`.)
2. Give it to the server one of two ways:
   - **Admin dashboard (recommended):** open `/admin` -> **Discord
     webhook** -> paste the URL -> **Send test message** (fires whatever
     is in the box, so you can verify before saving) -> **Save webhook**.
   - **Env default:** set `DISCORD_WEBHOOK_URL` (e.g.
     `fly secrets set DISCORD_WEBHOOK_URL=...`). A value saved in the
     admin dashboard overrides the env default; blank in the dashboard
     falls back to the env value.
3. To disable: clear the field in the dashboard and Save (and unset the
   env var if you set one).

## What posts

Same events as the DMs - a turn advancing and an auction opening - but as
a single message to the channel instead of a DM to each player. Inert when
no URL is configured.

## Security

- The webhook URL is a **secret** (anyone with it can post to your
  channel). It's stored server-side (`server_settings`) or as a Fly secret;
  never commit it. If it leaks, delete the webhook in Discord and make a
  new one.
- The URL is validated server-side against the Discord webhook URL shape,
  so a typo or a non-Discord host is rejected rather than silently failing.

---

## Code map (for maintainers)

- `server/discord.js` - three notification paths, each inert without its
  env vars:
  - DM sender (`sendDM`, `discordEnabled`; caches the per-user DM channel);
  - OAuth helpers (`oauthEnabled`, `oauthClientId`, `buildAuthorizeUrl`,
    `completeOauth` = code exchange -> identify -> guilds.join);
  - channel webhook (`sendWebhook`, `webhookEnabled`, `isWebhookUrl`,
    `defaultWebhookUrl`).
- `server/db.js` - `notify_prefs` table (per-profile opt-in). The webhook
  URL reuses the `server_settings` key/value table under
  `discord_webhook_url`.
- `server/index.js` - `GET/PUT /me/notify` (reports `discordEnabled` +
  `oauthEnabled`), `POST /me/notify/test` (DM); `POST /me/notify/oauth/start`
  (returns the authorize URL; one-time `state` held in memory with a
  10-min TTL) and `GET /auth/discord/callback` (server-side link +
  confirmation DM); `POST /admin/discord-webhook` +
  `POST /admin/discord-webhook/test` (webhook). `dispatchTurnNotifications()`
  fires DM + webhook after each committed op.
- `js/api.js` - `getNotifyPrefs` / `setNotifyPrefs` / `testNotify` /
  `startDiscordOauth`.
- `js/main.js` + `index.html` - the "Turn notifications" menu: the Connect
  Discord button (popup + poll), event checkboxes, Send test DM, and the
  manual user-ID fallback disclosure. The webhook is admin-only (`/admin`).
