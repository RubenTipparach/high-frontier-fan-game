# Discord turn notifications - setup

The game can DM a player on Discord when it's their turn (or when an
auction needs them). This is **opt-in per player** and **inert until you
configure a bot**, so a deployment with no bot behaves exactly as before.

How it works: the Fly API holds a Discord **bot token**. When a turn ends
(or an auction opens), the server opens a DM channel with the relevant
player's Discord account and posts a short message. Players link
themselves by pasting their Discord **user ID** into the in-app menu and
sending a test DM.

> Discord only delivers a bot DM if the bot **shares a server** with the
> user (and the user allows DMs from server members). So every player who
> wants notifications must be in a server the bot is also in.

---

## 1. Create the bot (once)

1. Go to the Discord Developer Portal: https://discord.com/developers/applications
2. **New Application** -> name it (e.g. "High Frontier").
3. Open the **Bot** tab -> **Add Bot**.
4. Under **Token**, click **Reset Token** and copy it. Treat it like a
   password - this is your `DISCORD_BOT_TOKEN`.
5. No privileged gateway intents are required (we only send DMs over REST,
   we never read messages), so you can leave the Message Content / Presence
   / Server Members intents **off**.

## 2. Invite the bot to your players' server

1. Developer Portal -> **OAuth2** -> **URL Generator**.
2. Scopes: check **`bot`**.
3. Bot Permissions: **Send Messages** is enough (DMs don't need channel
   perms, but this keeps the invite simple).
4. Copy the generated URL, open it, and add the bot to the Discord server
   your group plays in. Everyone who wants notifications must be a member
   of that server.

## 3. Give the API the token

The server reads `DISCORD_BOT_TOKEN` from the environment.

**Fly.io (production):**
```
fly secrets set DISCORD_BOT_TOKEN=your-bot-token-here
```
This restarts the app with the secret available. That's all the server
needs - `server/discord.js` picks it up at boot; `discordEnabled()` flips
to true and the notification endpoints start working.

**Local dev:**
```
cd server
DISCORD_BOT_TOKEN=your-bot-token-here DATABASE_PATH=./hf-dev.db npm run dev
```

Without the variable set, `/me/notify/test` returns `discord_disabled` and
no DMs are sent - the feature is simply dormant.

## 4. Each player links their account (in the app)

1. In Discord: **User Settings -> Advanced -> Developer Mode = ON**.
2. Right-click your own name -> **Copy User ID** (a long number like
   `123456789012345678`).
3. In the game: open the **menu (top-left ☰) -> Turn notifications**.
4. Paste the ID, choose which events to be DM'd about (your turn /
   auctions), click **Save**, then **Send test DM**.
5. You should receive a DM from the bot. If you don't, see Troubleshooting.

---

## What triggers a DM

- **Your turn starts** - when `END_TURN` advances the active seat to you.
- **An auction needs you** - when an auction opens, every player except
  the auctioneer is pinged.

One event = one DM, so there's no extra throttling to configure.

## Privacy / security notes

- The only thing stored is the player's Discord **user ID** (a public
  snowflake), in the `notify_prefs` table, opt-in. Clearing the field in
  settings removes notifications for that player.
- The bot **token** lives only in the server environment (Fly secret).
  Never commit it. If it leaks, **Reset Token** in the Developer Portal.
- The bot never reads messages or member lists; it only opens a DM channel
  and posts to it.

## Troubleshooting the test DM

- **"this server has no notification bot configured"** - `DISCORD_BOT_TOKEN`
  isn't set on the API. Re-check step 3.
- **"the bot couldn't DM you (send 403…)"** - you don't share a server with
  the bot, or your DMs from server members are off. Join the bot's server
  (step 2) and enable **Server Settings -> Privacy -> Allow direct
  messages from server members** for that server.
- **"that doesn't look like a Discord user ID"** - you pasted a username or
  a channel/server ID. Use **Copy User ID** on your own name with
  Developer Mode on.
- Still stuck? Check the API logs (`fly logs`) for `[notify] DM failed` -
  the Discord HTTP status is included.

## Code map (for maintainers)

- `server/discord.js` - REST DM sender (`sendDM`, `discordEnabled`); inert
  without the token; caches the per-user DM channel id.
- `server/db.js` - `notify_prefs` table (per-profile opt-in).
- `server/index.js` - `GET/PUT /me/notify`, `POST /me/notify/test`, and
  `dispatchTurnNotifications()` called after each committed op.
- `js/main.js` + `index.html` - the "Turn notifications" menu section.
- `js/api.js` - `getNotifyPrefs` / `setNotifyPrefs` / `testNotify`.
