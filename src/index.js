import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

for (const key of ['DISCORD_BOT_TOKEN','DISCORD_APPLICATION_ID','DISCORD_GUILD_ID','G2D_SHARED_SECRET']) if (!process.env[key]) throw new Error(`Missing ${key}`);
const app = express(); app.use(express.json({limit:'256kb'}));
const client = new Client({intents:[GatewayIntentBits.Guilds]});
const state={online:false,map:'unknown',players:0,round:'waiting',lastEvent:null};
const commands=[new SlashCommandBuilder().setName('status').setDescription('Show Notorious server status'),new SlashCommandBuilder().setName('players').setDescription('Show current player count'),new SlashCommandBuilder().setName('announce').setDescription('Send a server announcement').addStringOption(o=>o.setName('message').setDescription('Announcement text').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)].map(c=>c.toJSON());
const clean=(v,f='Unknown')=>String(v??f).slice(0,1000);
function embed(e){const type=clean(e.type,'server_event');const colors={round_end:0xff46d2,round_start:0x5cb8ff,player_join:0x64eb91,player_leave:0xffb347,clan:0x9b42ff};const x=new EmbedBuilder().setColor(colors[type]??0x5cb8ff).setTitle(`NOTORIOUS // ${type.replaceAll('_',' ').toUpperCase()}`).setTimestamp();for(const[k,v]of Object.entries(e))if(k!=='type'&&v!=null)x.addFields({name:clean(k).toUpperCase(),value:clean(v),inline:true});return x;}
async function logEvent(e){state.lastEvent=new Date().toISOString();if(!process.env.DISCORD_LOG_CHANNEL_ID)return;const c=await client.channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID).catch(()=>null);if(c?.isTextBased())await c.send({embeds:[embed(e)]}).catch(console.error);}
app.get('/health',(_,r)=>r.json({ok:true,discord:state.online,server:state}));
app.post('/gmod/event',async(req,r)=>{if(req.get('x-notorious-secret')!==process.env.G2D_SHARED_SECRET)return r.status(401).json({error:'unauthorized'});const e=req.body&&typeof req.body==='object'?req.body:{};if(e.type==='status')Object.assign(state,{online:true,map:e.map??state.map,players:e.players??state.players,round:e.round??state.round});await logEvent(e);r.json({ok:true});});
client.once('ready',async()=>{state.online=true;const rest=new REST({version:'10'}).setToken(process.env.DISCORD_BOT_TOKEN);await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID,process.env.DISCORD_GUILD_ID),{body:commands});console.log(`Notorious bot online as ${client.user.tag}`);});
client.on('interactionCreate',async i=>{if(!i.isChatInputCommand())return;if(i.commandName==='status')return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setColor(0x5cb8ff).setTitle('NOTORIOUS // SERVER STATUS').addFields({name:'STATUS',value:state.online?'Online':'Unknown',inline:true},{name:'MAP',value:clean(state.map),inline:true},{name:'PLAYERS',value:String(state.players),inline:true},{name:'ROUND',value:clean(state.round),inline:true})]});if(i.commandName==='players')return i.reply({ephemeral:true,content:`Notorious currently reports **${state.players}** players.`});if(i.commandName==='announce')return i.reply({content:`📢 **Notorious announcement:** ${i.options.getString('message')}`});});
client.on('error', error => console.error('[Discord] client error:', error));
client.on('debug', message => {
  if (!/provided token/i.test(message)) console.log('[Discord] debug:', message);
});
client.on('shardReady', shardId => console.log(`[Discord] shard ${shardId} is ready.`));
client.on('shardReconnecting', shardId => console.log(`[Discord] shard ${shardId} is reconnecting.`));
client.on('shardError', error => console.error('[Discord] gateway error:', error?.message || error));
client.on('shardDisconnect', (event, shardId) => console.error(`[Discord] gateway disconnected (shard ${shardId}, code ${event?.code ?? 'unknown'})`));
client.on('invalidated', () => console.error('[Discord] session invalidated; the token may have been reset or revoked.'));
setTimeout(() => {
  if (!state.online) {
    console.error('[Discord] gateway did not become ready within 20 seconds. Config present:', {
      botToken: Boolean(process.env.DISCORD_BOT_TOKEN),
      applicationId: Boolean(process.env.DISCORD_APPLICATION_ID),
      guildId: Boolean(process.env.DISCORD_GUILD_ID),
      sharedSecret: Boolean(process.env.G2D_SHARED_SECRET)
    });
    process.exit(1);
  }
}, 20000);
client.login(process.env.DISCORD_BOT_TOKEN).then(() => {
  console.log('[Discord] login accepted; waiting for READY.');
}).catch(error => {
  console.error('[Discord] login failed:', error?.message || error);
  process.exit(1);
});
app.listen(Number(process.env.PORT||3000),()=>console.log(`HTTP bridge listening on ${process.env.PORT||3000}`));
