import { EmbedBuilder, Events, PermissionFlagsBits } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { askGroq } from '../utils/groqClient.js';

const configPath = fileURLToPath(new URL('../config.json', import.meta.url));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const botChannelId = config.channels?.botChannelId || config.channels?.commandsBot;
const serverName = config.server?.name ?? 'DevVerse Studios';
const userCooldowns = new Map();
const ticketStaffRoleIds = new Set(Array.isArray(config.roles?.ticketNotifyRoles) ? config.roles.ticketNotifyRoles : []);
const userCooldownMs = Math.max(0, Number(config.cooldowns?.aiUserSeconds ?? 20)) * 1000;
const globalIntervalMs = Math.max(0, Number(config.cooldowns?.aiGlobalSeconds ?? 2)) * 1000;
let groqQueue = Promise.resolve();
let lastGroqRequestAt = 0;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueGroq(question, userTag, context) {
  const request = groqQueue.then(async () => {
    const delay = Math.max(0, globalIntervalMs - (Date.now() - lastGroqRequestAt));
    if (delay) await wait(delay);
    lastGroqRequestAt = Date.now();
    return askGroq(question, userTag, context);
  });
  groqQueue = request.then(() => undefined, () => undefined);
  return request;
}

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message.guild || message.author.bot) return;

    const mentioned = message.mentions.has(client.user);
    const isBotChannel = Boolean(botChannelId) && message.channelId === botChannelId;
    const ticketOwnerId = message.channel.topic?.match(/ticket-owner:(\d+)/)?.[1];
    const isTicket = Boolean(ticketOwnerId);
    const isTicketStaff = Boolean(message.member?.permissions.has(PermissionFlagsBits.Administrator))
      || Boolean(message.member?.roles.cache.some((role) => ticketStaffRoleIds.has(role.id)));
    const autoAnswerInTicket = isTicket && message.author.id === ticketOwnerId && !isTicketStaff;
    if (!mentioned && !isBotChannel && !autoAnswerInTicket) return;

    const question = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .trim();
    if (!question) {
      await message.reply('¡Hola! 👋 Menciónname con tu pregunta y te ayudaré con DevVerse Studios.').catch(console.error);
      return;
    }

    const now = Date.now();
    for (const [userId, expiresAt] of userCooldowns) {
      if (expiresAt <= now) userCooldowns.delete(userId);
    }
    const expiresAt = userCooldowns.get(message.author.id) ?? 0;
    if (expiresAt > now) {
      const seconds = Math.ceil((expiresAt - now) / 1000);
      await message.reply({
        content: `¡Te leí! Para cuidar el servicio, espera **${seconds} s** antes de volver a preguntarme. ⏳`,
        allowedMentions: { repliedUser: false },
      }).catch(console.error);
      return;
    }
    userCooldowns.set(message.author.id, now + userCooldownMs);

    try {
      await message.channel.sendTyping();
      const ticketType = message.channel.topic?.match(/type:([\w-]+)/)?.[1];
      const answer = await enqueueGroq(question, message.author.tag, {
        inTicket: isTicket,
        ticketType,
      });
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

