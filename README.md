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
