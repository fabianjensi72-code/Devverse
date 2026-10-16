import { EmbedBuilder, Events } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { askGroq } from '../utils/groqClient.js';

const configPath = fileURLToPath(new URL('../config.json', import.meta.url));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const botChannelId = config.channels?.botChannelId || config.channels?.commandsBot;
const serverName = config.server?.name ?? 'DevVerse Studios';

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message.guild || message.author.bot) return;

    const mentioned = message.mentions.has(client.user);
    const isBotChannel = Boolean(botChannelId) && message.channelId === botChannelId;
    if (!mentioned && !isBotChannel) return;

    const question = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .trim();
    if (!question) {
      await message.reply('¡Hola! 👋 Menciónname con tu pregunta y te ayudaré con DevVerse Studios.').catch(console.error);
      return;
    }

    try {
      await message.channel.sendTyping();
      const answer = await askGroq(question, message.author.tag);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setDescription(answer.slice(0, 4000))
        .setFooter({ text: serverName })
        .setTimestamp();

      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    } catch (error) {
      console.error('Error al responder con Groq:', error);
      await message.reply({
        content: 'Ahora mismo no pude consultar al asistente. Inténtalo de nuevo en un momento. 🤖',
        allowedMentions: { repliedUser: false },
      }).catch((replyError) => console.error('No se pudo enviar el mensaje de error:', replyError));
    }
  },
};
