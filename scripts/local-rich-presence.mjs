import { Client } from '@xhayper/discord-rpc';

const clientId = process.env.DISCORD_RPC_CLIENT_ID || process.env.DISCORD_APPLICATION_ID;
const healthUrl = process.env.NOTORIOUS_HEALTH_URL || 'https://notorious-discord-bot.onrender.com/health';
const websiteUrl = process.env.NOTORIOUS_WEBSITE_URL || 'https://ogpill.xyz';
const joinUrl = process.env.NOTORIOUS_JOIN_URL || 'https://notorious-discord-bot.onrender.com/join';

if (!clientId) {
  console.error('[Rich Presence] DISCORD_RPC_CLIENT_ID or DISCORD_APPLICATION_ID is required.');
  process.exit(1);
}

const client = new Client({
  clientId,
  transport: {
    type: 'ipc',
    pathList: [{ platform: ['win32'], format: id => `\\\\.\\pipe\\discord-ipc-${id}` }]
  }
});
let connected = false;
let reconnectTimer;
let refreshTimer;

function clean(value, fallback, limit = 80) {
  const text = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\u2013\u2014]/g, '-').trim();
  return (text || fallback).slice(0, limit);
}

function activityForHealth(health) {
  const server = health?.server || {};
  if (!health?.gmod) return { details: 'Notorious Pill Pack Hide & Seek', state: 'Server signal offline' };
  const players = Number.isFinite(Number(server.players)) ? Number(server.players) : 0;
  const maxPlayers = Number.isFinite(Number(server.maxPlayers)) ? Number(server.maxPlayers) : 0;
  const count = maxPlayers > 0 ? `${players}/${maxPlayers} players` : `${players} players`;
  return {
    details: `Notorious PPHS | ${count}`,
    state: `${clean(server.map, 'unknown', 48)} | ${clean(server.round, 'waiting', 48)}`
  };
}

async function fetchHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.warn(`[Rich Presence] Health check failed: ${error.message}`);
    return null;
  }
}

async function publish() {
  if (!connected || !client.user) return;
  const activity = activityForHealth(await fetchHealth());
  await client.user.setActivity({
    type: 0,
    details: activity.details,
    state: activity.state,
    largeImageUrl: 'https://notorious-discord-bot.onrender.com/assets/notorious-server.png',
    largeImageText: 'Notorious live server',
    buttons: [
      { label: 'Website', url: websiteUrl },
      { label: 'Join Server', url: joinUrl }
    ]
  });
  console.log(`[Rich Presence] Updated: ${activity.details} | ${activity.state}`);
}

async function connect() {
  if (connected) return;
  try {
    await client.login();
  } catch (error) {
    connected = false;
    console.error(`[Rich Presence] Discord Canary connection failed: ${error.message}`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 15000);
  }
}

client.on('ready', async () => {
  connected = true;
  console.log('[Rich Presence] Connected to Discord Canary.');
  await publish().catch(error => console.error(`[Rich Presence] Publish failed: ${error.message}`));
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => publish().catch(error => console.error(`[Rich Presence] Publish failed: ${error.message}`)), 30000);
  refreshTimer.unref();
});

client.on('disconnected', () => {
  connected = false;
  console.warn('[Rich Presence] Discord Canary disconnected.');
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 15000);
});

client.on('error', error => console.error(`[Rich Presence] RPC error: ${error.message}`));
connect();
