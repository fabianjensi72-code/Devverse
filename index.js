import 'dotenv/config';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, REST, Routes } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || token === 'tu_token_aqui' || !clientId || clientId === 'tu_client_id_aqui') {
  throw new Error('Configura DISCORD_TOKEN y CLIENT_ID en el archivo .env antes de iniciar el bot.');
}

const client = new Client({
  // MessageContent solo es necesario si luego se procesan mensajes normales.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

async function loadModules(folder, handler) {
  const directory = path.join(__dirname, folder);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.js'));

  for (const file of files) {
    const moduleUrl = pathToFileURL(path.join(directory, file)).href;
    const module = await import(moduleUrl);
    await handler(module.default, file);
  }
}

await loadModules('commands', (command, file) => {
  if (!command?.data?.name || typeof command.execute !== 'function') {
    throw new TypeError(`El comando ${file} debe exportar data y execute.`);
  }
  client.commands.set(command.data.name, command);
});

await loadModules('events', (event, file) => {
  if (!event?.name || typeof event.execute !== 'function') {
    throw new TypeError(`El evento ${file} debe exportar name y execute.`);
  }

  const listener = (...args) => event.execute(...args, client);
  if (event.once) client.once(event.name, listener);
  else client.on(event.name, listener);
});

// Publica la definición actual de los comandos de aplicación al iniciar.
const rest = new REST({ version: '10' }).setToken(token);
const commandPayload = [...client.commands.values()].map((command) => command.data.toJSON());

try {
  // Para desarrollo, registrar en el servidor los hace aparecer enseguida.
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commandPayload });
  console.log(`Comandos slash registrados: ${commandPayload.length}${guildId ? ` en el servidor ${guildId}` : ' globalmente'}`);
  if (!guildId) console.log('Consejo: añade GUILD_ID al .env para publicar los comandos de inmediato en tu servidor.');
} catch (error) {
  console.error('No se pudieron registrar los comandos slash:', error);
}

// Registrar estos manejadores evita que fallos no capturados cierren silenciosamente el proceso.
process.on('unhandledRejection', (reason) => console.error('Promesa rechazada sin manejar:', reason));
process.on('uncaughtException', (error) => console.error('Excepción no capturada:', error));
client.on('error', (error) => console.error('Error del cliente Discord:', error));
client.on('shardError', (error) => console.error('Error de conexión del shard:', error));

await client.login(token);
