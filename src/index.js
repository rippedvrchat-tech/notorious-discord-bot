import 'dotenv/config';
import dns from 'node:dns';
import { createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GameDig } from 'gamedig';
import { formatPublicChatMessage, isRelayablePublicChat } from './chat-policy.js';
import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

dns.setDefaultResultOrder('ipv4first');

const REQUIRED_ENV = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_APPLICATION_ID',
  'DISCORD_GUILD_ID',
  'G2D_SHARED_SECRET'
];
const missingEnvironment = () => REQUIRED_ENV.filter(key => !process.env[key]);
const initialMissing = missingEnvironment();
if (initialMissing.length) {
  console.error(`[Config] Missing environment variables: ${initialMissing.join(', ')}`);
}

const app = express();
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
app.disable('x-powered-by');
app.use('/assets', express.static(path.join(moduleDirectory, '..', 'assets'), {
  immutable: true,
  maxAge: '7d'
}));
app.use(express.raw({
  type: request => !request.is('application/json'),
  limit: '64kb'
}));
app.use(express.json({
  limit: '64kb',
  strict: true,
  verify: (request, _response, buffer) => {
    request.rawBody = Buffer.from(buffer);
  }
}));

app.get('/join', (_request, response) => response.redirect(302, gmodJoinUri));
function envNumber(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value))) : fallback;
}
const discordRest = process.env.DISCORD_BOT_TOKEN
  ? new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN) : null;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const presence = {
  status: 'online',
  activity: 'Notorious PPHS',
  lastPublishedAt: null
};
const startedAt = Date.now();
const bridgeStaleMs = envNumber('GMOD_STALE_MS', 75000, 45000, 3600000);
const gatewayEnabled = String(process.env.DISCORD_GATEWAY_ENABLED || 'true').toLowerCase() !== 'false';
const loginRetryMs = envNumber('DISCORD_RETRY_MS', 30000, 15000, 3600000);
const loginTimeoutMs = envNumber('DISCORD_LOGIN_TIMEOUT_MS', 45000, 15000, 120000);
const deliveryTimeoutMs = envNumber('DISCORD_DELIVERY_TIMEOUT_MS', 15000, 5000, 60000);
const httpCommandTimeoutMs = envNumber('DISCORD_HTTP_COMMAND_TIMEOUT_MS', 2000, 500, 2500);
const apiVerificationTimeoutMs = envNumber('DISCORD_API_VERIFICATION_TIMEOUT_MS', 5000, 1000, 15000);
const maxChatLength = envNumber('DISCORD_CHAT_MAX_LENGTH', 1800, 100, 1800);
const port = envNumber('PORT', 3000, 1, 65535);

const discordHttp = {
  enabled: false,
  verified: false,
  apiVerified: false,
  apiLastCheckedAt: null,
  apiLastError: null,
  lastInteractionAt: null,
  publicKey: null
};

if (process.env.DISCORD_PUBLIC_KEY) {
  try {
    const rawKey = Buffer.from(process.env.DISCORD_PUBLIC_KEY.trim(), 'hex');
    if (rawKey.length !== 32) throw new Error('Public key must contain 32 bytes');
    discordHttp.publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]),
      format: 'der',
      type: 'spki'
    });
    discordHttp.enabled = true;
  } catch (error) {
    console.error('[Discord] HTTP interaction public key is invalid:', error.message);
  }
}

const COLORS = {
  blue: 0x35b9ff,
  pink: 0xff4fd8,
  purple: 0x8b5cf6,
  green: 0x4ade80,
  amber: 0xfbbf24,
  red: 0xfb7185,
  slate: 0x64748b
};

const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || 'https://notorious-discord-bot.onrender.com').replace(/\/+$/, '');
const validChannelId = value => /^\d{17,20}$/.test(String(value));
const discordChatChannelId = process.env.DISCORD_CHAT_CHANNEL_ID || '1528106297080156180';
const discordLogChannelId = process.env.DISCORD_LOG_CHANNEL_ID || '1533995392096796703';
const discordUserAgent = 'NotoriousDiscordBot/1.0 (+https://ogpill.xyz)';
const discordAlertChannelId = process.env.DISCORD_ALERT_CHANNEL_ID || '';
const discordStatusTargets = [
  {
    name: 'game',
    channelId: process.env.DISCORD_STATUS_CHANNEL_ID || '1537799353056497704',
    messageId: process.env.DISCORD_STATUS_MESSAGE_ID || '1543214242650398720'
  },
  {
    name: 'website',
    channelId: process.env.DISCORD_WEBSITE_STATUS_CHANNEL_ID || '1537799281975627846',
    messageId: process.env.DISCORD_WEBSITE_STATUS_MESSAGE_ID || '1543214243413885041'
  }
].map(target => ({
  ...target,
  messageId: validChannelId(target.messageId) ? target.messageId : null
}));
const statusUpdateCooldownMs = envNumber('DISCORD_STATUS_UPDATE_COOLDOWN_MS', 15000, 5000, 120000);
const statusLastNames = new Map();
const statusNextAllowedAt = new Map();
const statusLastContents = new Map();
if (!validChannelId(discordChatChannelId) || !validChannelId(discordLogChannelId) ||
    discordStatusTargets.some(target => !validChannelId(target.channelId))) {
  console.error('[Discord] Channel IDs must be valid Discord snowflakes.');
}
const websiteUrl = process.env.WEBSITE_URL || 'https://ogpill.xyz';
const gmodJoinUri = process.env.GMOD_JOIN_URI || 'steam://connect/193.243.190.129:27015';
const gameQueryHost = process.env.GMOD_QUERY_HOST || '193.243.190.129';
const gameQueryPort = envNumber('GMOD_QUERY_PORT', 27015, 1, 65535);
const gameQueryIntervalMs = envNumber('GMOD_QUERY_INTERVAL_MS', 5000, 3000, 60000);
const gameQueryTimeoutMs = envNumber('GMOD_QUERY_TIMEOUT_MS', 15000, 5000, 60000);
const directQueryEnabled = process.env.GMOD_DIRECT_QUERY_ENABLED !== 'false';
const joinUrl = process.env.JOIN_URL || `${publicBaseUrl}/join`;
const ASSETS = {
  server: `${publicBaseUrl}/assets/notorious-server.png`,
  identity: `${publicBaseUrl}/assets/notorious-identity.png`,
  community: `${publicBaseUrl}/assets/notorious-community.png`,
  help: `${publicBaseUrl}/assets/notorious-help.png`
};

const bridge = {
  map: 'unknown',
  players: 0,
  maxPlayers: 0,
  playerNames: [],
  round: 'waiting',
  hostname: 'Notorious Pill Pack Hide & Seek',
  version: 'unknown',
  lastSignalAt: null,
  lastEventAt: null,
  lastEventType: null
};
let gameQueryInFlight = false;
let gameQuerySequence = 0;
let gameQueryInitialized = false;

const delivery = {
  lastType: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  consecutiveFailures: 0
};
const inFlightDeliveries = new Set();
let liveStatusUpdateRunning = false;
let liveStatusUpdateQueued = false;

const commands = [
  new SlashCommandBuilder().setName('status').setDescription('Show the live Notorious server dashboard'),
  new SlashCommandBuilder().setName('players').setDescription('Show the live player count and player list'),
  new SlashCommandBuilder().setName('map').setDescription('Show the current Garry\'s Mod map'),
  new SlashCommandBuilder().setName('round').setDescription('Show the current Pill Pack round state'),
  new SlashCommandBuilder().setName('uptime').setDescription('Show bot uptime and bridge freshness'),
  new SlashCommandBuilder().setName('help').setDescription('Show every Notorious bot command'),
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send a Notorious announcement to the log channel')
    .addStringOption(option => option
      .setName('message')
      .setDescription('Announcement text')
      .setMaxLength(1000)
      .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show private Notorious integration diagnostics')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(command => command.toJSON());

function clean(value, fallback = 'Unknown', limit = 1000) {
  const raw = String(value ?? fallback)
    .replace(/\u00e2\u20ac[\u201c\u201d\u0093\u0094]/g, '-')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return (raw || fallback).slice(0, limit);
}

function markdownSafe(value, fallback = 'Unknown', limit = 1000) {
  return clean(value, fallback, limit)
    .replace(/([\\`*_{}\[\]()#+.!|>~-])/g, '\\$1')
    .replace(/@/g, '@\u200b');
}

function duration(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes}m`, `${seconds}s`].filter(Boolean).join(' ');
}

function discordTime(value) {
  const timestamp = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:R>` : 'No signal received';
}

function bridgeAge() {
  return bridge.lastSignalAt ? Date.now() - new Date(bridge.lastSignalAt).getTime() : Infinity;
}

function bridgeIsLive() {
  return bridgeAge() <= bridgeStaleMs;
}

function serverStatusEmoji() {
  if (!bridge.lastSignalAt) return '🔴';
  return bridgeIsLive() ? '🟢' : '🟡';
}

function websiteStatusEmoji() {
  return bridgeIsLive() ? '🟢' : '🔴';
}

function liveStatusBoardText() {
  return `${serverStatusEmoji()} | ${playerCountText()} players`;
}

function liveStatusChannelName(target, websiteOnline = bridgeIsLive()) {
  if (target.name === 'website') return `${websiteOnline ? '🟢' : '🔴'} | ogpill.xyz`;
  return liveStatusBoardText();
}

async function websiteIsOnline(signal) {
  try {
    const response = await fetch(websiteUrl, { method: 'HEAD', signal });
    return response.ok;
  } catch {
    return false;
  }
}

async function patchStatusChannel(channelId, name, signal) {
  if (statusLastNames.get(channelId) === name) return;
  try {
    const current = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      signal
    });
    if (current.ok) {
      const channel = await current.json();
      if (channel.name === name) {
        statusLastNames.set(channelId, name);
        return;
      }
    }
  } catch {
    // Continue to the update attempt; trackedDelivery supplies the timeout.
  }
  const waitMs = Math.max(0, (statusNextAllowedAt.get(channelId) || 0) - Date.now());
  if (waitMs > 0) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Status update aborted'));
      }, { once: true });
    });
  }
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name }),
    signal
  });
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || statusUpdateCooldownMs / 1000;
      const retryDelayMs = Math.min(120000, Math.max(5000, retryAfter * 1000));
      statusNextAllowedAt.set(channelId, Date.now() + retryDelayMs);
      setTimeout(() => queueLiveStatusUpdate(), retryDelayMs).unref();
    }
    throw new Error(`Discord channel update failed with HTTP ${response.status}`);
  }
  statusLastNames.set(channelId, name);
  statusNextAllowedAt.set(channelId, Date.now() + statusUpdateCooldownMs);
}

function liveStatusMessageContent(target, websiteOnline) {
  if (target.name === 'website') return `${websiteOnline ? '🟢' : '🔴'} | **ogpill.xyz**`;
  return `${serverStatusEmoji()} | **${playerCountText()} players**\nMap: **${currentMapName()}**`;
}

async function patchStatusMessage(channelId, messageId, content, signal) {
  if (statusLastContents.get(messageId) === content) return;
  try {
    const current = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      signal
    });
    if (current.ok) {
      const message = await current.json();
      if (message.content === content) {
        statusLastContents.set(messageId, content);
        return;
      }
    }
  } catch {
    // Continue to the update attempt; trackedDelivery supplies the timeout.
  }
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': discordUserAgent
    },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal
  });
  if (!response.ok) throw new Error(`Discord status message update failed with HTTP ${response.status}`);
  statusLastContents.set(messageId, content);
}

function discordIsConnected() {
  return client.isReady() || (discordHttp.enabled && discordHttp.apiVerified);
}

function discordConnectionText() {
  if (client.isReady()) return 'Connected by Gateway';
  if (discordHttp.enabled && discordHttp.apiVerified) return 'Connected by signed HTTP';
  if (discordHttp.enabled) return 'HTTP signing ready; Discord API unavailable';
  return 'Reconnecting';
}

async function verifyDiscordApi() {
  discordHttp.apiLastCheckedAt = new Date().toISOString();
  if (!discordRest) {
    discordHttp.apiVerified = false;
    discordHttp.apiLastError = 'DISCORD_BOT_TOKEN is missing';
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiVerificationTimeoutMs);
  try {
    await Promise.race([
      discordRest.get(Routes.user('@me'), { signal: controller.signal }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Discord API verification timed out after ${apiVerificationTimeoutMs}ms`)),
        apiVerificationTimeoutMs
      ))
    ]);
    discordHttp.apiVerified = true;
    discordHttp.apiLastError = null;
    return true;
  } catch (error) {
    discordHttp.apiVerified = false;
    discordHttp.apiLastError = clean(error?.message || error, 'Discord API verification failed', 300);
    console.error('[Discord] API verification failed:', discordHttp.apiLastError);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function publishPresence() {
  if (!client.isReady() || !client.user) return false;
  client.user.setPresence({
    status: presence.status,
    afk: false,
    activities: [{ name: presence.activity, type: ActivityType.Playing }]
  });
  presence.lastPublishedAt = new Date().toISOString();
  console.log(`[Discord] Presence set to online: ${presence.activity}.`);
  return true;
}

function playerCountText() {
  return bridge.maxPlayers > 0 ? `${bridge.players} / ${bridge.maxPlayers}` : String(bridge.players);
}

function currentMapName() {
  return clean(bridge.map, 'unknown', 128);
}

function brandedEmbed({ title, description, color = COLORS.blue, image = ASSETS.identity }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'NOTORIOUS SERVER NETWORK' })
    .setTitle(clean(title, 'Notorious', 256))
    .setDescription(clean(description, 'Live server information.', 4096))
    .setThumbnail(ASSETS.identity)
    .setFooter({ text: 'Notorious | Pill Pack Hide & Seek' })
    .setTimestamp();
  if (image) embed.setImage(image);
  return embed;
}

function serverLinkComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Website').setStyle(ButtonStyle.Link).setURL(websiteUrl),
    new ButtonBuilder().setLabel('Join Server').setStyle(ButtonStyle.Link).setURL(joinUrl)
  )];
}

function statusEmbed() {
  const live = bridgeIsLive();
  return brandedEmbed({
    title: live ? 'Live Server Control Center' : 'Server Signal Interrupted',
    description: live
      ? 'Live telemetry is being received directly from the Garry\'s Mod server.'
      : 'Discord is online, but the Garry\'s Mod heartbeat is missing or stale.',
    color: live ? COLORS.blue : COLORS.red,
    image: ASSETS.server
  }).addFields(
    { name: 'Discord', value: discordConnectionText(), inline: true },
    { name: 'GMod bridge', value: live ? 'Connected' : 'Waiting for signal', inline: true },
    { name: 'Players', value: playerCountText(), inline: true },
    { name: 'Current map', value: `\`${markdownSafe(bridge.map, 'unknown', 900)}\``, inline: true },
    { name: 'Round state', value: `\`${markdownSafe(bridge.round, 'waiting', 900)}\``, inline: true },
    { name: 'Last GMod signal', value: discordTime(bridge.lastSignalAt), inline: true },
    { name: 'Bot uptime', value: duration(Date.now() - startedAt), inline: true },
    { name: 'Server', value: markdownSafe(bridge.hostname, 'Notorious', 900), inline: true }
  );
}

function playersEmbed() {
  const live = bridgeIsLive();
  const names = bridge.playerNames.slice(0, 32);
  const list = names.length
    ? names.map((name, index) => `**${index + 1}.** ${markdownSafe(name, 'Unknown player', 80)}`).join('\n').slice(0, 1024)
    : 'No players are currently online.';
  return brandedEmbed({
    title: 'Live Player Roster',
    description: live
      ? `The server currently has **${playerCountText()}** players connected.`
      : 'The GMod signal is stale. The roster below is the last received snapshot.',
    color: live ? COLORS.green : COLORS.amber,
    image: ASSETS.community
  }).addFields(
    { name: 'Player list', value: list, inline: false },
    { name: 'Map', value: markdownSafe(bridge.map, 'unknown'), inline: true },
    { name: 'Round', value: markdownSafe(bridge.round, 'waiting'), inline: true },
    { name: 'Signal', value: discordTime(bridge.lastSignalAt), inline: true }
  );
}

function mapEmbed() {
  const map = currentMapName();
  return brandedEmbed({
    title: 'Current Map',
    description: bridgeIsLive()
      ? `The server is currently running **${markdownSafe(map)}**.`
      : `Last reported map: **${markdownSafe(map)}**. The GMod signal is stale.`,
    color: bridgeIsLive() ? COLORS.blue : COLORS.amber,
    image: ASSETS.server
  }).addFields(
    { name: 'Map name', value: markdownSafe(map), inline: true },
    { name: 'Players', value: playerCountText(), inline: true },
    { name: 'Round', value: markdownSafe(bridge.round, 'waiting'), inline: true },
    { name: 'Last signal', value: discordTime(bridge.lastSignalAt), inline: true }
  );
}

function roundEmbed() {
  return brandedEmbed({
    title: 'Pill Pack Round',
    description: `Current round state: **${markdownSafe(bridge.round, 'waiting')}**`,
    color: bridgeIsLive() ? COLORS.purple : COLORS.amber,
    image: ASSETS.identity
  }).addFields(
    { name: 'Map', value: markdownSafe(bridge.map, 'unknown'), inline: true },
    { name: 'Players', value: playerCountText(), inline: true },
    { name: 'Bridge', value: bridgeIsLive() ? 'Connected' : 'Signal stale', inline: true }
  );
}

function uptimeEmbed() {
  return brandedEmbed({
    title: 'Network Uptime',
    description: 'Connection timing for the Discord bot and GMod telemetry bridge.',
    color: bridgeIsLive() ? COLORS.blue : COLORS.amber,
    image: ASSETS.help
  }).addFields(
    { name: 'Bot uptime', value: duration(Date.now() - startedAt), inline: true },
    { name: 'GMod heartbeat', value: bridgeIsLive() ? 'Fresh' : 'Stale', inline: true },
    { name: 'Last signal', value: discordTime(bridge.lastSignalAt), inline: true }
  );
}

function helpEmbed() {
  return brandedEmbed({
    title: 'Command Center',
    description: 'Live tools for the Notorious Pill Pack Hide & Seek community.',
    color: COLORS.pink,
    image: ASSETS.help
  }).addFields(
    { name: 'Live server', value: '`/status`  `/players`  `/map`  `/round`  `/uptime`', inline: false },
    { name: 'Community', value: '`/help`', inline: false },
    { name: 'Staff', value: '`/announce`  `/serverinfo`\nStaff commands require Manage Server permission.', inline: false },
    { name: 'Connection model', value: 'Server data comes from a signed heartbeat sent by the live GMod server.', inline: false }
  );
}

function diagnosticsEmbed() {
  const missing = missingEnvironment();
  return brandedEmbed({
    title: 'Private Integration Diagnostics',
    description: 'Current Discord process and Garry\'s Mod bridge state.',
    color: missing.length || !bridgeIsLive() ? COLORS.amber : COLORS.green,
    image: ASSETS.identity
  }).addFields(
    { name: 'Discord commands', value: discordConnectionText(), inline: true },
    { name: 'GMod heartbeat', value: bridgeIsLive() ? 'Connected' : 'Missing or stale', inline: true },
    { name: 'Configuration', value: missing.length ? `Missing: ${missing.join(', ')}` : 'Complete', inline: true },
    { name: 'Bridge version', value: markdownSafe(bridge.version, 'unknown'), inline: true },
    { name: 'Last event', value: markdownSafe(bridge.lastEventType, 'none'), inline: true },
    { name: 'Last signal', value: discordTime(bridge.lastSignalAt), inline: true },
    { name: 'Map', value: markdownSafe(bridge.map, 'unknown'), inline: true },
    { name: 'Players', value: playerCountText(), inline: true },
    { name: 'Round', value: markdownSafe(bridge.round, 'waiting'), inline: true }
  );
}

function eventEmbed(event) {
  const type = clean(event.type, 'server_event', 64).toLowerCase();
  const labels = {
    player_join: 'Player Joined',
    player_leave: 'Player Left',
    player_death: 'Player Eliminated',
    round_start: 'Round Started',
    round_end: 'Round Ended',
    map_change: 'Map Changed'
  };
  const colors = {
    player_join: COLORS.green,
    player_leave: COLORS.amber,
    player_death: COLORS.red,
    round_start: COLORS.blue,
    round_end: COLORS.pink,
    map_change: COLORS.purple
  };
  const playerName = markdownSafe(event.player, 'Unknown player', 200);
  const descriptions = {
    player_join: `**${playerName}** joined the server.`,
    player_leave: `**${playerName}** left the server.`,
    player_death: `**${playerName}** was eliminated.`
  };
  const embed = brandedEmbed({
    title: labels[type] || clean(type.replaceAll('_', ' '), 'Server Event', 256),
    description: descriptions[type] || 'A new event was received from the live GMod server.',
    color: colors[type] || COLORS.blue,
    image: ['player_join', 'player_leave'].includes(type) ? ASSETS.community : ASSETS.server
  }).addFields(
    { name: 'Map', value: markdownSafe(event.map ?? bridge.map, 'unknown'), inline: true },
    { name: 'Players', value: playerCountText(), inline: true },
    { name: 'Round', value: markdownSafe(event.round ?? bridge.round, 'waiting'), inline: true }
  );
  if (event.steamid) embed.addFields({ name: 'Steam ID', value: markdownSafe(event.steamid, 'unknown', 100), inline: true });
  if (event.attacker) embed.addFields({ name: 'Attacker', value: markdownSafe(event.attacker, 'unknown', 200), inline: true });
  if (event.winner) embed.addFields({ name: 'Winner', value: markdownSafe(event.winner, 'unknown', 200), inline: true });
  return embed;
}

function announcementEmbed(message, author) {
  return brandedEmbed({
    title: 'Community Announcement',
    description: markdownSafe(message, 'No announcement text.', 1000),
    color: COLORS.pink,
    image: ASSETS.identity
  }).addFields({ name: 'Posted by', value: markdownSafe(author, 'Notorious Staff', 200), inline: true });
}

async function logChannel() {
  const channelId = discordLogChannelId;
  if (!channelId || !client.isReady()) return null;
  const channel = await client.channels.fetch(channelId).catch(error => {
    console.error('[Discord] Log channel fetch failed:', error.message);
    return null;
  });
  return channel?.isTextBased() ? channel : null;
}

async function sendChatMessage(content, signal) {
  if (!validChannelId(discordChatChannelId)) return false;
  const message = String(content || '').slice(0, 2000);
  if (!message) return false;
  if (client.isReady()) {
    const channel = await client.channels.fetch(discordChatChannelId).catch(() => null);
    if (channel?.isTextBased()) { await channel.send({ content: message, allowedMentions: { parse: [] } }); return true; }
  }
  if (!discordRest) return false;
  await discordRest.post(Routes.channelMessages(discordChatChannelId), {
    body: { content: message, allowed_mentions: { parse: [] } },
    signal
  });
  return true;
}
async function sendLogEmbed(embed, signal) {
  if (!validChannelId(discordLogChannelId)) return false;
  const channel = await logChannel();
  if (channel) {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  }
  const channelId = discordLogChannelId;
  if (!channelId || !discordRest) return false;
  await discordRest.post(Routes.channelMessages(channelId), {
    body: { embeds: [embed.toJSON()], allowed_mentions: { parse: [] } },
    signal
  });
  return true;
}

async function sendCriticalAlert(event, signal) {
  if (!validChannelId(discordAlertChannelId) || !discordRest) return false;
  const embed = brandedEmbed({
    title: 'Critical Server Alert',
    description: markdownSafe(event.message, 'The server reported a critical condition.', 1500),
    color: COLORS.red,
    timestamp: new Date().toISOString()
  }).addFields(
    { name: 'Type', value: markdownSafe(event.alertType, 'server', 100), inline: true },
    { name: 'Map', value: markdownSafe(event.map, 'unknown', 100), inline: true },
    { name: 'Players', value: String(Math.max(0, Number(event.players) || 0)), inline: true }
  );
  await discordRest.post(Routes.channelMessages(discordAlertChannelId), {
    body: { embeds: [embed.toJSON()], allowed_mentions: { parse: [] } }, signal
  });
  return true;
}

async function sendLiveStatusMessage(signal) {
  if (!discordRest || !discordStatusTargets.length) return false;
  const websiteOnline = await websiteIsOnline(signal);
  for (const target of discordStatusTargets.filter(target => validChannelId(target.channelId))) {
    await patchStatusChannel(target.channelId, liveStatusChannelName(target, websiteOnline), signal);
  }
  return true;
}

function queueLiveStatusUpdate() {
  liveStatusUpdateQueued = true;
  if (liveStatusUpdateRunning) return;
  liveStatusUpdateRunning = true;
  void (async () => {
    while (liveStatusUpdateQueued) {
      liveStatusUpdateQueued = false;
      try {
        await trackedDelivery('live_status', signal => sendLiveStatusMessage(signal));
      } catch (error) {
        console.error('[Discord] Live status update failed:', error?.message || error);
      }
    }
    liveStatusUpdateRunning = false;
  })();
}

async function trackedDelivery(type, operation, timeoutMs = deliveryTimeoutMs) {
  delivery.lastType = clean(type, 'unknown', 64);
  delivery.lastAttemptAt = new Date().toISOString();
  const deliveryKey = clean(type, 'unknown', 64);
  if (inFlightDeliveries.has(deliveryKey)) {
    throw new Error('Discord delivery already in progress');
  }
  inFlightDeliveries.add(deliveryKey);
  let operationPromise;
  const controller = new AbortController();
  let timeoutHandle;
  let forcedCleanupHandle;
  try {
    operationPromise = Promise.resolve().then(() => operation(controller.signal));
    const sent = await Promise.race([
      operationPromise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error('Discord delivery timed out'));
        }, timeoutMs);
        forcedCleanupHandle = setTimeout(() => inFlightDeliveries.delete(deliveryKey), timeoutMs + 2000);
        forcedCleanupHandle.unref?.();
      })
    ]);
    if (!sent) throw new Error('Discord delivery is not configured for this message type');
    delivery.lastSuccessAt = new Date().toISOString();
    delivery.lastError = null;
    delivery.consecutiveFailures = 0;
    return true;
  } catch (error) {
    delivery.lastFailureAt = new Date().toISOString();
    delivery.lastError = clean(error?.message || error, 'Unknown Discord delivery failure', 300);
    delivery.consecutiveFailures += 1;
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    // Keep the key until a timed-out underlying request settles, preventing late
    // Discord responses from racing a replacement message.
    if (operationPromise) {
      operationPromise.finally(() => {
        if (forcedCleanupHandle) clearTimeout(forcedCleanupHandle);
        inFlightDeliveries.delete(deliveryKey);
      }).catch(() => {});
    } else {
      inFlightDeliveries.delete(deliveryKey);
    }
  }
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

function updateBridge(event) {
  const previous = {
    map: bridge.map,
    players: bridge.players,
    maxPlayers: bridge.maxPlayers,
    round: bridge.round,
    hostname: bridge.hostname,
    version: bridge.version
  };
  const now = new Date().toISOString();
  bridge.lastSignalAt = now;
  bridge.lastEventAt = now;
  bridge.lastEventType = clean(event.type, 'server_event', 64).toLowerCase();
  bridge.map = clean(event.map, bridge.map, 128);
  bridge.round = clean(event.round, bridge.round, 128);
  bridge.hostname = clean(event.hostname, bridge.hostname, 256);
  bridge.version = clean(event.bridgeVersion, bridge.version, 64);
  bridge.players = boundedNumber(event.players, bridge.players, 0, 256);
  bridge.maxPlayers = boundedNumber(event.maxPlayers, bridge.maxPlayers, 0, 256);
  if (Array.isArray(event.playerNames)) {
    bridge.playerNames = event.playerNames.slice(0, 64).map(name => clean(name, 'Unknown player', 80));
  }
  return previous.map !== bridge.map || previous.players !== bridge.players ||
    previous.maxPlayers !== bridge.maxPlayers || previous.round !== bridge.round ||
    previous.hostname !== bridge.hostname || previous.version !== bridge.version;
}

async function pollGameServer() {
  if (gameQueryInFlight) return;
  gameQueryInFlight = true;
  const querySequence = ++gameQuerySequence;
  let timeoutHandle;
  try {
    const query = GameDig.query({
      type: 'garrysmod',
      host: gameQueryHost,
      port: gameQueryPort,
      maxAttempts: 1,
      attemptTimeout: gameQueryTimeoutMs
    });
    const server = await Promise.race([
      query,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Game query timed out after ${gameQueryTimeoutMs}ms`)),
          gameQueryTimeoutMs
        );
      })
    ]);
    if (querySequence !== gameQuerySequence) return;
    const changed = updateBridge({
      type: 'status',
      map: server.map,
      players: server.players.length,
      maxPlayers: server.maxplayers,
      hostname: server.name,
      playerNames: server.players.map(player => player.name).filter(Boolean),
      bridgeVersion: 'gamedig'
    });
    if (changed && gameQueryInitialized) queueLiveStatusUpdate();
    gameQueryInitialized = true;
  } catch (error) {
    console.error('[GameQuery] Server query failed:', error?.message || error);
    setTimeout(() => void pollGameServer(), 2000).unref();
  } finally {
    clearTimeout(timeoutHandle);
    gameQueryInFlight = false;
  }
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const first = Buffer.from(String(provided));
  const second = Buffer.from(String(expected));
  return first.length === second.length && timingSafeEqual(first, second);
}

function validDiscordSignature(request) {
  if (!discordHttp.publicKey || !Buffer.isBuffer(request.rawBody)) return false;
  const signature = request.get('x-signature-ed25519');
  const timestamp = request.get('x-signature-timestamp');
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const requestTime = Number(timestamp) * 1000;
  if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 300000) return false;
  try {
    return verifySignature(
      null,
      Buffer.concat([Buffer.from(timestamp), request.rawBody]),
      discordHttp.publicKey,
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

function interactionUser(interaction) {
  return interaction.member?.user || interaction.user || {};
}

function interactionUserName(interaction) {
  const user = interactionUser(interaction);
  return clean(user.global_name || user.username, 'Notorious Staff', 200);
}

function interactionHasManageGuild(interaction) {
  try {
    const permissions = BigInt(interaction.member?.permissions || '0');
    return (permissions & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild;
  } catch {
    return false;
  }
}

function commandOption(interaction, name) {
  const option = Array.isArray(interaction.data?.options)
    ? interaction.data.options.find(item => item.name === name)
    : null;
  return option?.value;
}

function interactionMessage({ embed, content, components = [], ephemeral = false }) {
  const data = { allowed_mentions: { parse: [] } };
  if (embed) data.embeds = [embed.toJSON()];
  if (content) data.content = clean(content, 'Command completed.', 2000);
  if (components.length) data.components = components.map(component => component.toJSON());
  if (ephemeral) data.flags = Number(MessageFlags.Ephemeral);
  return { type: 4, data };
}

function interactionTargetsThisBot(interaction) {
  const applicationId = String(interaction?.application_id || '');
  const guildId = String(interaction?.guild_id || '');
  return applicationId === String(process.env.DISCORD_APPLICATION_ID || '') &&
    guildId === String(process.env.DISCORD_GUILD_ID || '');
}

async function httpCommandResponse(interaction) {
  if (!interactionTargetsThisBot(interaction)) {
    return interactionMessage({ content: 'This interaction is not addressed to this server.', ephemeral: true });
  }
  const name = clean(interaction.data?.name, '', 64).toLowerCase();
  if (['announce', 'serverinfo'].includes(name) && !interactionHasManageGuild(interaction)) {
    return interactionMessage({ content: 'You need Manage Server permission to use this command.', ephemeral: true });
  }
  switch (name) {
    case 'status':
      return interactionMessage({ embed: statusEmbed(), components: serverLinkComponents() });
    case 'players':
      return interactionMessage({ embed: playersEmbed(), components: serverLinkComponents() });
    case 'map':
      return interactionMessage({
        content: `Current map: ${currentMapName()}`,
        embed: mapEmbed(),
        components: serverLinkComponents()
      });
    case 'round':
      return interactionMessage({ embed: roundEmbed(), components: serverLinkComponents() });
    case 'uptime':
      return interactionMessage({ embed: uptimeEmbed(), components: serverLinkComponents() });
    case 'help':
      return interactionMessage({ embed: helpEmbed(), components: serverLinkComponents() });
    case 'serverinfo':
      return interactionMessage({ embed: diagnosticsEmbed(), components: serverLinkComponents(), ephemeral: true });
    case 'announce': {
      const message = commandOption(interaction, 'message');
      if (typeof message !== 'string' || !message.trim()) {
        return interactionMessage({ content: 'Announcement text is required.', ephemeral: true });
      }
      const sent = await trackedDelivery('announcement', signal =>
        sendLogEmbed(announcementEmbed(message, interactionUserName(interaction)), signal), httpCommandTimeoutMs);
      return interactionMessage({ content: sent
        ? 'Announcement sent to the configured Notorious log channel.' : 'Announcement could not be sent.', ephemeral: true });
    }
    default:
      return interactionMessage({ content: 'That command is not available.', ephemeral: true });
  }
}

app.post('/interactions', async (request, response) => {
  if (!discordHttp.enabled) return response.status(503).json({ error: 'interactions_not_configured' });
  if (!validDiscordSignature(request)) return response.status(401).json({ error: 'invalid_signature' });
  discordHttp.verified = true;
  discordHttp.lastInteractionAt = new Date().toISOString();
  const interaction = request.body;
  if (interaction?.type === 1) return response.json({ type: 1 });
  if (interaction?.type !== 2) {
    return response.json(interactionMessage({ content: 'This interaction type is not supported.', ephemeral: true }));
  }
  try {
    return response.json(await httpCommandResponse(interaction));
  } catch (error) {
    console.error('[Discord] HTTP interaction failed:', error?.message || error);
    return response.json(interactionMessage({
      content: 'The command could not be completed. Staff have been notified.',
      ephemeral: true
    }));
  }
});

app.get('/', (_request, response) => response.json({
  service: 'Notorious Discord Bot',
  ok: true,
  discord: discordIsConnected(),
  discordMode: client.isReady() ? 'gateway' : (discordHttp.enabled ? 'http' : 'waiting'),
  presence: client.isReady() ? presence.status : 'unavailable without Gateway',
  gmod: bridgeIsLive()
}));

app.get('/health', (_request, response) => response.json({
  ok: true,
  configured: missingEnvironment().length === 0,
  discord: discordIsConnected(),
  discordMode: client.isReady() ? 'gateway' : (discordHttp.enabled ? 'http' : 'waiting'),
  presence: client.isReady() ? presence.status : 'unavailable without Gateway',
  presenceActivity: presence.activity,
  presenceLastPublishedAt: presence.lastPublishedAt,
  httpInteractionsConfigured: discordHttp.enabled,
  discordApiVerified: discordHttp.apiVerified,
  discordApiLastCheckedAt: discordHttp.apiLastCheckedAt,
  discordApiLastError: discordHttp.apiLastError,
  channelRouting: {
    publicChatChannelId: discordChatChannelId,
    logAndAnnouncementChannelId: discordLogChannelId,
    statusChannels: discordStatusTargets.map(target => ({
      name: target.name,
      channelId: target.channelId,
      messageIdConfigured: Boolean(target.messageId)
    }))
  },
  lastInteractionAt: discordHttp.lastInteractionAt,
  gmod: bridgeIsLive(),
  server: {
    map: bridge.map,
    players: bridge.players,
    maxPlayers: bridge.maxPlayers,
    round: bridge.round,
    lastSignalAt: bridge.lastSignalAt,
    lastEventType: bridge.lastEventType,
    bridgeVersion: bridge.version
  },
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  delivery: {
    lastType: delivery.lastType,
    lastAttemptAt: delivery.lastAttemptAt,
    lastSuccessAt: delivery.lastSuccessAt,
    lastFailureAt: delivery.lastFailureAt,
    lastError: delivery.lastError,
    consecutiveFailures: delivery.consecutiveFailures
  },
}));

async function handleGmodEvent(request, response) {
  const localTrusted = request.path === '/gmod/event-local' &&
    (request.ip === '127.0.0.1' || request.ip === '::1' || request.ip === '::ffff:127.0.0.1');
  if (!localTrusted) {
  if (!process.env.G2D_SHARED_SECRET) return response.status(503).json({ error: 'bridge_not_configured' });
  if (!secretsMatch(request.get('x-notorious-secret'), process.env.G2D_SHARED_SECRET)) {
    return response.status(401).json({ error: 'unauthorized' });
  }
  }
  let parsedBody = request.body;
  if (Buffer.isBuffer(parsedBody) || typeof parsedBody === 'string') {
    try {
      parsedBody = JSON.parse(parsedBody.toString('utf8'));
    } catch {
      return response.status(400).json({ error: 'invalid_json' });
    }
  }
  const event = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody) ? parsedBody : null;
  if (!event || typeof event.type !== 'string' || !/^[a-z0-9_]{1,64}$/i.test(event.type)) {
    return response.status(400).json({ error: 'invalid_event' });
  }
  const eventType = event.type.toLowerCase();
  event.type = eventType;
  const bridgeChanged = directQueryEnabled ? false : updateBridge(event);
  const playerCountEvent = eventType === 'player_join' || eventType === 'player_leave';
  if (eventType === 'status') {
    if (bridgeChanged && !directQueryEnabled) queueLiveStatusUpdate();
    return response.json({ ok: true, received: 'status', bridgeLive: true, delivered: false, transport: 'telemetry' });
  }
  if (playerCountEvent && !directQueryEnabled) queueLiveStatusUpdate();
  if (eventType === 'chat') {
    if (!isRelayablePublicChat(event.message, event)) {
      return response.json({ ok: true, received: 'chat', bridgeLive: true, delivered: false, filtered: true });
    }
    try {
      const player = clean(event.player, 'Player', 120);
      const message = clean(event.message, '', maxChatLength);
      await trackedDelivery('chat', signal => sendChatMessage(formatPublicChatMessage(player, message), signal));
    } catch (error) {
      console.error('[Discord] Chat delivery failed:', error?.message || error);
      return response.status(502).json({ error: 'discord_delivery_failed', received: 'chat', bridgeLive: true });
    }
    return response.json({ ok: true, received: 'chat', bridgeLive: true, delivered: true, transport: 'bot' });
  }
  if (eventType === 'critical_alert') {
    try {
      await trackedDelivery('critical_alert', signal => sendCriticalAlert(event, signal));
    } catch (error) {
      console.error('[Discord] Critical alert delivery failed:', error?.message || error);
      return response.status(502).json({ error: 'discord_delivery_failed', received: 'critical_alert', bridgeLive: true });
    }
    return response.json({ ok: true, received: 'critical_alert', bridgeLive: true, delivered: true, transport: 'bot' });
  }
  return response.json({
    ok: true, received: clean(eventType, 'server_event', 64), bridgeLive: true,
    delivered: false, transport: 'discordtoolkit'
  });
}

app.post('/gmod/event', handleGmodEvent);
app.post('/gmod/event-local', handleGmodEvent);

app.use((error, _request, response, _next) => {
  console.error('[HTTP] Request failed:', error.message);
  response.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: 'invalid_request' });
});

let commandRetryTimer = null;
let commandRegistrationInProgress = false;
async function registerCommands() {
  clearTimeout(commandRetryTimer);
  if (commandRegistrationInProgress) return;
  if (!discordRest || !process.env.DISCORD_APPLICATION_ID || !process.env.DISCORD_GUILD_ID) {
    console.error('[Discord] Command registration skipped because configuration is incomplete.');
    return;
  }
  commandRegistrationInProgress = true;
  try {
    await discordRest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log(`[Discord] Registered ${commands.length} guild commands.`);
  } catch (error) {
    console.error('[Discord] Command registration failed:', error?.message || error);
    commandRetryTimer = setTimeout(registerCommands, 60000);
  } finally {
    commandRegistrationInProgress = false;
  }
}

client.on('clientReady', async () => {
  console.log(`[Discord] Connected as ${client.user.tag}.`);
  publishPresence();
  await registerCommands();
});

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'status':
      return interaction.reply({ embeds: [statusEmbed()], components: serverLinkComponents(), allowedMentions: { parse: [] } });
    case 'players':
      return interaction.reply({ embeds: [playersEmbed()], components: serverLinkComponents(), allowedMentions: { parse: [] } });
    case 'map':
      return interaction.reply({
        content: `Current map: ${currentMapName()}`,
        embeds: [mapEmbed()],
        components: serverLinkComponents(),
        allowedMentions: { parse: [] }
      });
    case 'round':
      return interaction.reply({ embeds: [roundEmbed()], components: serverLinkComponents(), allowedMentions: { parse: [] } });
    case 'uptime':
      return interaction.reply({ embeds: [uptimeEmbed()], components: serverLinkComponents(), allowedMentions: { parse: [] } });
    case 'help':
      return interaction.reply({ embeds: [helpEmbed()], components: serverLinkComponents(), allowedMentions: { parse: [] } });
    case 'serverinfo':
      return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [diagnosticsEmbed()], components: serverLinkComponents(), allowedMentions: { parse: [] } });
    case 'announce': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const message = interaction.options.getString('message', true);
      const sent = await trackedDelivery('announcement', signal =>
        sendLogEmbed(announcementEmbed(message, interaction.user.tag), signal));
      return interaction.editReply(sent
        ? 'Announcement sent to the configured Notorious log channel.'
        : 'Announcement could not be sent because the log channel is unavailable.');
    }
    default:
      return interaction.reply({ content: 'That command is not available.', flags: MessageFlags.Ephemeral });
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`[Discord] Command /${interaction.commandName} failed:`, error?.message || error);
    const payload = { content: 'The command could not be completed. Staff have been notified.' };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.on('error', error => console.error('[Discord] Client error:', error?.message || error));
client.on('shardError', error => console.error('[Discord] Gateway error:', error?.message || error));
client.on('shardReady', id => {
  console.log(`[Discord] Shard ${id} ready.`);
  publishPresence();
});
client.on('shardDisconnect', (event, id) => console.error(`[Discord] Shard ${id} disconnected with code ${event?.code ?? 'unknown'}.`));

let loginInProgress = false;
let loginRetryTimer = null;
async function connectDiscord() {
  clearTimeout(loginRetryTimer);
  if (!gatewayEnabled) return;
  if (client.isReady() || loginInProgress) return;
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('[Discord] Login skipped because DISCORD_BOT_TOKEN is missing.');
    loginRetryTimer = setTimeout(connectDiscord, loginRetryMs);
    return;
  }
  loginInProgress = true;
  try {
    await Promise.race([
      client.login(process.env.DISCORD_BOT_TOKEN),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Gateway login timed out after ${loginTimeoutMs}ms`)),
        loginTimeoutMs
      ))
    ]);
  } catch (error) {
    console.error('[Discord] Login failed:', error?.message || error);
    client.destroy();
    loginRetryTimer = setTimeout(connectDiscord, loginRetryMs);
  } finally {
    loginInProgress = false;
  }
}

setInterval(() => {
  if (!client.isReady() && !loginInProgress) connectDiscord();
  void verifyDiscordApi();
}, 60000).unref();

setTimeout(registerCommands, 1000).unref();
void verifyDiscordApi();
connectDiscord();
app.listen(port, '0.0.0.0', () => {
  console.log(`[HTTP] Bridge listening on port ${port}.`);
});
setInterval(() => void pollGameServer(), gameQueryIntervalMs).unref();
void pollGameServer();
