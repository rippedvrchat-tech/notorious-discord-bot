import { ActivityType, Client, GatewayIntentBits } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('[Presence] DISCORD_BOT_TOKEN is missing.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', () => {
  client.user.setPresence({
    status: 'online',
    afk: false,
    activities: [{ name: 'Notorious PPHS', type: ActivityType.Playing }]
  });
  console.log(`[Presence] Connected as ${client.user.tag}. Online presence published.`);
});

client.on('error', error => console.error('[Presence] Client error:', error?.message || error));
client.on('shardError', error => console.error('[Presence] Gateway error:', error?.message || error));
client.on('shardDisconnect', event => console.error(`[Presence] Gateway disconnected: ${event?.code ?? 'unknown'}.`));

client.login(token).catch(error => {
  console.error('[Presence] Login failed:', error?.message || error);
  process.exit(1);
});
