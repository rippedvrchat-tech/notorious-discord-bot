# Notorious Discord Bot

Discord command bot and signed GMod telemetry bridge for Notorious Pill Pack Hide & Seek.

## Commands

- `/status`: Live Discord and GMod connection dashboard
- `/players`: Current player count and player roster
- `/map`: Current GMod map
- `/round`: Current Pill Pack round state
- `/uptime`: Bot uptime and heartbeat freshness
- `/help`: Public command guide
- `/announce`: Staff announcement embed
- `/serverinfo`: Private staff diagnostics

`/announce` and `/serverinfo` require Manage Server permission.

## Required environment variables

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `G2D_SHARED_SECRET`
- `DISCORD_PUBLIC_KEY` for signed HTTP interactions

`DISCORD_LOG_CHANNEL_ID` is optional, but event logs and `/announce` require it.

Public GMod chat is relayed only when it is ordinary public chat. Commands,
mentions, team chat, and messages marked private/admin/staff are filtered both
in the GMod bridge and again in this bot. Discord mentions are disabled and
relay text is escaped before it is posted.

Public chat is sent only to `DISCORD_CHAT_CHANNEL_ID`. Event embeds and
`/announce` are sent only to `DISCORD_LOG_CHANNEL_ID`. Both values are checked
as Discord channel IDs at startup.

The live player-count embed is maintained in both `DISCORD_STATUS_CHANNEL_ID`
and `DISCORD_WEBSITE_STATUS_CHANNEL_ID`. The bot edits one reusable status
message in each channel whenever the heartbeat reports a changed player count
or server state, so neither channel is flooded.

`DISCORD_DELIVERY_TIMEOUT_MS`, `DISCORD_HTTP_COMMAND_TIMEOUT_MS`, and
`DISCORD_CHAT_MAX_LENGTH` control delivery timeouts and the maximum public chat
payload. HTTP commands use a short timeout to stay within Discord's response
window. The bot does not restart the GMod server; live server restarts remain a
manual operator action.

Secrets belong in the deployment environment and must never be committed to GitHub. Install with `npm install`, then run `npm start`.

## Health checks

- `GET /`: Basic process, Discord, and GMod state
- `GET /health`: Detailed process and bridge state
- `POST /gmod/event`: Signed GMod telemetry input using the `x-notorious-secret` header

The service stays online when Discord is temporarily unavailable and retries the gateway connection. GMod is only shown as connected while signed heartbeats are fresh.

When the Discord Gateway connects, the bot publishes an online presence with the activity `Notorious PPHS` and republishes it after reconnects. Discord does not provide bots with an API option to force the mobile phone badge. Signed HTTP interactions can keep commands working, but they cannot publish a presence without a Gateway session.

Slash commands can arrive through Discord's signed HTTP interaction endpoint at `POST /interactions`. This is the primary command path when the hosting provider cannot maintain a Discord Gateway connection. Every request is verified with the application's Ed25519 public key before any command is handled.

The four Notorious embed images are stored under `assets/` and served by the bot at `/assets/*`. This keeps embeds stable after the original signed Discord CDN links expire.

## Personal Rich Presence

Run `npm run rich-presence` on the Windows PC where Discord Canary is open. This updates the logged-in user's profile through Discord's local RPC connection with live Notorious server details and Website / Join Server buttons. It does not use the bot token. `scripts/run-rich-presence.ps1` keeps retrying when Discord Canary is closed and reconnects when it opens.
