# Notorious Discord Bot

Discord command bot and signed GMod telemetry bridge for Notorious Pill Pack Hide & Seek.

## Commands

- `/status`: Live Discord and GMod connection dashboard
- `/players`: Current player count and player roster
- `/map`: Current GMod map
- `/round`: Current Pill Pack round state
- `/uptime`: Bot uptime and heartbeat freshness
- `/help`: Public command guide
- `/activity`: Launch the Notorious live Discord Activity when Activities are enabled
- `/announce`: Staff announcement embed
- `/serverinfo`: Private staff diagnostics

`/announce` and `/serverinfo` require Manage Server permission.

## Required environment variables

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `G2D_SHARED_SECRET`
- `DISCORD_PUBLIC_KEY` for signed HTTP interactions
- `DISCORD_ACTIVITY_ENABLED=true` after enabling Activities for the application in the Discord Developer Portal

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

## Discord Activity

The live Activity is served at `/activity` and shows the current GMod map, round, player count, bridge state, Website button, and Join Server button. Enable Activities for this application in the Discord Developer Portal, configure the Activity URL as `https://notorious-discord-bot.onrender.com/activity`, add `DISCORD_ACTIVITY_ENABLED=true` to the deployment environment, then redeploy. Discord will create the global Activity entry point; users can launch it from the App Launcher or with `/activity`.

The `/activity` interaction responds with Discord's `LAUNCH_ACTIVITY` callback (`type: 12`). If Activities are not enabled, leave `DISCORD_ACTIVITY_ENABLED=false`; the normal bot commands and message buttons continue to work.
