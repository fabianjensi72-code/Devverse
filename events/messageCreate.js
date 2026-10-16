import { EmbedBuilder, Events, PermissionFlagsBits } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { askGroq, translateEnglishToSpanish } from '../utils/groqClient.js';

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
let translationQueue = Promise.resolve();

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

const englishMarkers = new Set('i im ive id my mine me you your yours he she we they it this that these those the a an and or but if then because so is are was were be been being have has had do does did can could would should will may might must need want help please hello hi hey how what when where why who which someone anyone account game games roblox developer staff ticket problem issue scam scammed stolen stole hacked hack payment money purchase bought refund lost cant cannot dont didnt doesnt wasnt werent arent wasnt worked broken bug error collaboration build builder scripter'.split(' '));
const spanishMarkers = new Set('yo mi mis me nosotros nos ellos ellas tu tus usted ustedes el la los las un una unos unas y o pero si entonces porque es son era fueron ser estado tener tengo tienes tiene tenía ayuda hola buenas que como cuando donde quien cual alguien cuenta juego juegos desarrollador equipo ticket problema inconveniente estafa estafaron robado robaron hackearon pago dinero compra compre reembolso perdi no puedo funciona roto error colaboración construir'.split(' '));

function looksLikeEnglish(text) {
  const words = text.toLowerCase().match(/[a-záéíóúüñ]+/g) ?? [];
  if (words.length === 0) return false;
  const englishScore = words.filter((word) => englishMarkers.has(word)).length;
  const spanishScore = words.filter((word) => spanishMarkers.has(word)).length;
  return words.length <= 3
    ? englishScore >= 1 && spanishScore === 0
    : englishScore >= 2 && englishScore > spanishScore;
}

function enqueueTranslation(message, text) {
  const job = translationQueue.then(async () => {
    const translation = await translateEnglishToSpanish(text);
    if (!translation) return;

    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x2ecc71)
        .setDescription(`🇪🇸 **Traducción al español**\n${translation.slice(0, 4000)}`)],
      allowedMentions: { repliedUser: false },
    });
  }).catch((error) => {
    console.error(`No se pudo traducir al español el mensaje ${message.id}:`, error);
  });

  // Una traducción fallida no bloquea la siguiente; todas conservan el orden de llegada.
  translationQueue = job.then(() => undefined, () => undefined);
  return job;
}

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message.guild || message.author.bot) return;

    const originalText = message.content.trim();
    if (originalText && looksLikeEnglish(originalText)) {
      void enqueueTranslation(message, originalText);
    }

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

