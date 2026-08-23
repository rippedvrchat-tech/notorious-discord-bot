import { ActivityType, Client, GatewayIntentBits } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('[Presence] DISCORD_BOT_TOKEN is missing.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const healthUrl = 'https://notorious-discord-bot.onrender.com/health';

function clean(value, fallback, limit = 100) {
  const text = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (text || fallback).slice(0, limit);
}

function activityForHealth(health) {
  const server = health?.server || {};
  if (!health?.gmod) {
    return { name: 'Notorious Pill Pack', state: 'Server Offline' };
  }
  const players = Number.isFinite(Number(server.players)) ? Number(server.players) : 0;
  const maxPlayers = Number.isFinite(Number(server.maxPlayers)) ? Number(server.maxPlayers) : 0;
  const count = maxPlayers > 0 ? `${players}/${maxPlayers} Players` : `${players} Players`;
  const map = clean(server.map, 'unknown', 48);
  const round = clean(server.round, 'waiting', 48);
  return {
    name: 'Notorious Pill Pack',
    state: `${count} | ${map} | ${round}`.slice(0, 128)
  };
}

async function updatePresence() {
  if (!client.isReady()) return;
  let activity;
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
    activity = response.ok ? activityForHealth(await response.json()) : { name: 'Notorious Pill Pack', state: 'Server Offline' };
  } catch {
    activity = { name: 'Notorious Pill Pack', state: 'Server Offline' };
  }
  client.user.setPresence({
    status: 'online',
    afk: false,
    activities: [{ name: activity.name, state: activity.state, type: ActivityType.Playing }]
  });
  console.log(`[Presence] Updated: ${activity.name} | ${activity.state}`);
}

client.once('clientReady', () => {
  console.log(`[Presence] Connected as ${client.user.tag}.`);
  updatePresence();
  setInterval(updatePresence, 60000).unref();
});

client.on('error', error => console.error('[Presence] Client error:', error?.message || error));
client.on('shardError', error => console.error('[Presence] Gateway error:', error?.message || error));
client.on('shardDisconnect', event => console.error(`[Presence] Gateway disconnected: ${event?.code ?? 'unknown'}.`));

client.login(token).catch(error => {
  console.error('[Presence] Login failed:', error?.message || error);
  process.exit(1);
});
