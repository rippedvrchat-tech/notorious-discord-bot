import 'dotenv/config';
import dns from 'node:dns';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
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
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb', strict: true }));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const startedAt = Date.now();
const bridgeStaleMs = Math.max(45000, Number(process.env.GMOD_STALE_MS || 75000));
const loginRetryMs = Math.max(15000, Number(process.env.DISCORD_RETRY_MS || 30000));
const loginTimeoutMs = Math.max(15000, Number(process.env.DISCORD_LOGIN_TIMEOUT_MS || 45000));

const COLORS = {
  blue: 0x35b9ff,
  pink: 0xff4fd8,
  purple: 0x8b5cf6,
  green: 0x4ade80,
  amber: 0xfbbf24,
  red: 0xfb7185,
  slate: 0x64748b
};

const ASSETS = {
  server: 'https://cdn.discordapp.com/attachments/1527542125531500684/1540378469328883803/image.png?ex=6a8bb6fd&is=6a8a657d&hm=a2d5acd2013810c47edca862d9f0cf4a9887e14b05c5355b513703c6b8954818&',
  identity: 'https://cdn.discordapp.com/attachments/1527542125531500684/1540380037411250196/image.png?ex=6a8bb873&is=6a8a66f3&hm=8e0a12a787984400a3871d25c8204caefc5cea41de4a525fdeb3b096b7857aeb&',
  community: 'https://cdn.discordapp.com/attachments/1527542125531500684/1540378245504041090/image.png?ex=6a8bb6c8&is=6a8a6548&hm=2911809496e99c815ebe081313c4d881d8c1cdfab4ea709d362090dfa68297be&',
  help: 'https://cdn.discordapp.com/attachments/1527542125531500684/1540376353059242004/image.png?ex=6a8bb505&is=6a8a6385&hm=e09b8c6e495135d49a20cfc540ff19bf2c2a5cc8e27b7dc515ce78e27616ca9f&'
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
    .replace(/[\u2013\u2014]/g, '-')
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

function playerCountText() {
  return bridge.maxPlayers > 0 ? `${bridge.players} / ${bridge.maxPlayers}` : String(bridge.players);
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
    { name: 'Discord', value: client.isReady() ? 'Connected' : 'Reconnecting', inline: true },
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
  return brandedEmbed({
    title: 'Current Map',
    description: bridgeIsLive()
      ? `The server is currently running **${markdownSafe(bridge.map, 'unknown')}**.`
      : `Last reported map: **${markdownSafe(bridge.map, 'unknown')}**. The GMod signal is stale.`,
    color: bridgeIsLive() ? COLORS.blue : COLORS.amber,
    image: ASSETS.server
  }).addFields(
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
    { name: 'Discord gateway', value: client.isReady() ? 'Connected' : 'Reconnecting', inline: true },
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
    description: clean(message, 'No announcement text.', 1000),
    color: COLORS.pink,
    image: ASSETS.identity
  }).addFields({ name: 'Posted by', value: markdownSafe(author, 'Notorious Staff', 200), inline: true });
}

async function logChannel() {
  const channelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (!channelId || !client.isReady()) return null;
  const channel = await client.channels.fetch(channelId).catch(error => {
    console.error('[Discord] Log channel fetch failed:', error.message);
    return null;
  });
  return channel?.isTextBased() ? channel : null;
}

async function sendLogEmbed(embed) {
  const channel = await logChannel();
  if (!channel) return false;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  return true;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

function updateBridge(event) {
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
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const first = Buffer.from(String(provided));
  const second = Buffer.from(String(expected));
  return first.length === second.length && timingSafeEqual(first, second);
}

app.get('/', (_request, response) => response.json({
  service: 'Notorious Discord Bot',
  ok: true,
  discord: client.isReady(),
  gmod: bridgeIsLive()
}));

app.get('/health', (_request, response) => response.json({
  ok: true,
  configured: missingEnvironment().length === 0,
  discord: client.isReady(),
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
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
}));

app.post('/gmod/event', async (request, response) => {
  if (!process.env.G2D_SHARED_SECRET) return response.status(503).json({ error: 'bridge_not_configured' });
  if (!secretsMatch(request.get('x-notorious-secret'), process.env.G2D_SHARED_SECRET)) {
    return response.status(401).json({ error: 'unauthorized' });
  }
  const event = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : null;
  if (!event || typeof event.type !== 'string' || !/^[a-z0-9_]{1,64}$/i.test(event.type)) {
    return response.status(400).json({ error: 'invalid_event' });
  }
  updateBridge(event);
  if (event.type !== 'status') {
    sendLogEmbed(eventEmbed(event)).catch(error => console.error('[Discord] Event log failed:', error.message));
  }
  return response.json({ ok: true, received: clean(event.type, 'server_event', 64), bridgeLive: true });
});

app.use((error, _request, response, _next) => {
  console.error('[HTTP] Request failed:', error.message);
  response.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: 'invalid_request' });
});

let commandRetryTimer = null;
async function registerCommands() {
  clearTimeout(commandRetryTimer);
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_APPLICATION_ID || !process.env.DISCORD_GUILD_ID) {
    console.error('[Discord] Command registration skipped because configuration is incomplete.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log(`[Discord] Registered ${commands.length} guild commands.`);
  } catch (error) {
    console.error('[Discord] Command registration failed:', error?.message || error);
    commandRetryTimer = setTimeout(registerCommands, 60000);
  }
}

client.on('ready', async () => {
  console.log(`[Discord] Connected as ${client.user.tag}.`);
  await registerCommands();
});

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'status':
      return interaction.reply({ embeds: [statusEmbed()], allowedMentions: { parse: [] } });
    case 'players':
      return interaction.reply({ embeds: [playersEmbed()], allowedMentions: { parse: [] } });
    case 'map':
      return interaction.reply({ embeds: [mapEmbed()], allowedMentions: { parse: [] } });
    case 'round':
      return interaction.reply({ embeds: [roundEmbed()], allowedMentions: { parse: [] } });
    case 'uptime':
      return interaction.reply({ embeds: [uptimeEmbed()], allowedMentions: { parse: [] } });
    case 'help':
      return interaction.reply({ embeds: [helpEmbed()], allowedMentions: { parse: [] } });
    case 'serverinfo':
      return interaction.reply({ ephemeral: true, embeds: [diagnosticsEmbed()], allowedMentions: { parse: [] } });
    case 'announce': {
      await interaction.deferReply({ ephemeral: true });
      const message = interaction.options.getString('message', true);
      const sent = await sendLogEmbed(announcementEmbed(message, interaction.user.tag));
      return interaction.editReply(sent
        ? 'Announcement sent to the configured Notorious log channel.'
        : 'Announcement could not be sent because the log channel is unavailable.');
    }
    default:
      return interaction.reply({ content: 'That command is not available.', ephemeral: true });
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`[Discord] Command /${interaction.commandName} failed:`, error?.message || error);
    const payload = { content: 'The command could not be completed. Staff have been notified.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on('error', error => console.error('[Discord] Client error:', error?.message || error));
client.on('shardError', error => console.error('[Discord] Gateway error:', error?.message || error));
client.on('shardReady', id => console.log(`[Discord] Shard ${id} ready.`));
client.on('shardDisconnect', (event, id) => console.error(`[Discord] Shard ${id} disconnected with code ${event?.code ?? 'unknown'}.`));

let loginInProgress = false;
let loginRetryTimer = null;
async function connectDiscord() {
  clearTimeout(loginRetryTimer);
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
}, 60000).unref();

connectDiscord();
app.listen(Number(process.env.PORT || 3000), () => {
  console.log(`[HTTP] Bridge listening on port ${process.env.PORT || 3000}.`);
});
