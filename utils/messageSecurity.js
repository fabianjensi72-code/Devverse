import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const warningsPath = path.join(dataDirectory, 'message-warnings.json');
const userActivity = new Map();
let storageQueue = Promise.resolve();

const defaultAllowedDomains = [
  'roblox.com',
  'youtube.com',
  'youtu.be',
  'github.com',
];

function getAllowedDomains(config) {
  const domains = config.security?.allowedLinkDomains ?? defaultAllowedDomains;
  return domains.map((domain) => String(domain).toLowerCase().replace(/^\.+|\.+$/g, ''));
}

function extractLinks(text) {
  return text.match(/\b(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi) ?? [];
}

function isAllowedLink(link, allowedDomains) {
  try {
    const url = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function checkSpam(message, now, config) {
  const userKey = `${message.guild.id}:${message.author.id}`;
  const content = message.content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
  const activity = userActivity.get(userKey) ?? { timestamps: [], contents: [] };
  const spamWindowMs = Math.max(1, Number(config.security?.spamWindowSeconds ?? 8)) * 1000;
  const duplicateWindowMs = Math.max(1, Number(config.security?.duplicateWindowSeconds ?? 20)) * 1000;
  const spamLimit = Math.max(2, Number(config.security?.spamMessageLimit ?? 5));
  const duplicateLimit = Math.max(2, Number(config.security?.duplicateMessageLimit ?? 3));
  activity.timestamps = activity.timestamps.filter((time) => now - time < spamWindowMs);
  activity.contents = activity.contents.filter((item) => now - item.time < duplicateWindowMs);
  activity.timestamps.push(now);
  if (content) activity.contents.push({ content, time: now });
  userActivity.set(userKey, activity);

  if (activity.timestamps.length >= spamLimit) return 'spam';
  if (content && activity.contents.filter((item) => item.content === content).length >= duplicateLimit) return 'repeated_message';
  return null;
}

async function readWarnings() {
  try {
    return JSON.parse(await readFile(warningsPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { users: {} };
  }
}

function recordWarning(guildId, userId, reason, now, expiryMs, warningLimit) {
  const operation = storageQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    const state = await readWarnings();
    state.users ??= {};
    const key = `${guildId}:${userId}`;
    const recent = (state.users[key] ?? []).filter((item) => now - item.at < expiryMs);
    recent.push({ reason, at: now });
    const timedOut = recent.length >= warningLimit;
    state.users[key] = timedOut ? [] : recent;
    const tempPath = `${warningsPath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tempPath, warningsPath);
    return { count: timedOut ? 3 : recent.length, timedOut };
  });
  storageQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function sendNotice(message, config, description, isTimeout) {
  const channelId = config.security?.warningChannelId;
  if (!channelId) {
    console.error('Aviso de moderación omitido: configura security.warningChannelId.');
    return;
  }

  try {
    const channel = await message.guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
      console.error(`El canal de advertencias ${channelId} no existe o no admite mensajes.`);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(isTimeout ? 0xe74c3c : 0xf1c40f)
      .setTitle(isTimeout ? '⛔ Sanción aplicada' : '⚠️ Advertencia de moderación')
      .setDescription(description)
      .addFields(
        { name: 'Miembro', value: `<@${message.author.id}>`, inline: true },
        { name: 'Canal del incidente', value: `<#${message.channelId}>`, inline: true },
      )
      .setFooter({ text: 'DevVerse Studios • Moderación automática' })
      .setTimestamp();
    await channel.send({
      embeds: [embed],
      allowedMentions: { users: [message.author.id] },
    });
  } catch (error) {
    console.error(`No se pudo publicar la advertencia en ${channelId}:`, error);
  }
}

/** Returns true when the message is a moderation incident and should not be processed by the assistant. */
export async function enforceMessageSecurity(message, config) {
  const now = Date.now();
  const security = config.security ?? {};
  const links = extractLinks(message.content);
  const hasUntrustedLink = links.some((link) => !isAllowedLink(link, getAllowedDomains(config)));
  const spamReason = checkSpam(message, now, config);
  const reason = hasUntrustedLink ? 'untrusted_link' : spamReason;

  // Evita que el mapa de actividad crezca indefinidamente en servidores grandes.
  if (userActivity.size > 5_000) {
    for (const [key, activity] of userActivity) {
      if (!activity.timestamps.some((time) => now - time < 20_000)) userActivity.delete(key);
    }
  }
  if (!reason) return false;

  try {
    const botMember = message.guild.members.me ?? await message.guild.members.fetchMe();
    if (!botMember.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) {
      await sendNotice(
        message,
        config,
        `Detecté un mensaje que debía moderarse en <#${message.channelId}>, pero no pude borrarlo porque me falta **Gestionar mensajes** en ese canal. No sumé una advertencia al miembro.`,
        false,
      );
      console.error(`Moderación omitida en ${message.channelId}: al bot le falta ManageMessages.`);
      return true;
    }
    await message.delete();
  } catch (error) {
    await sendNotice(
      message,
      config,
      `Detecté un mensaje que debía moderarse en <#${message.channelId}>, pero Discord rechazó el borrado. No sumé una advertencia al miembro. Revisa **Gestionar mensajes** y los permisos de la categoría.`,
      false,
    );
    console.error('No se pudo borrar el mensaje moderado:', error);
    return true;
  }
  const warningLimit = Math.max(2, Number(security.timeoutAtWarnings ?? 3));
  const expiryMs = Math.max(1, Number(security.warningsExpireAfterDays ?? 30)) * 24 * 60 * 60 * 1000;
  const timeoutMs = Math.max(1, Number(security.timeoutMinutes ?? 10)) * 60 * 1000;
  const allowedDomains = getAllowedDomains(config);
  const warning = await recordWarning(message.guild.id, message.author.id, reason, now, expiryMs, warningLimit);

  if (warning.timedOut) {
    let timeoutApplied = false;
    try {
      await message.member.timeout(timeoutMs, `${warningLimit} advertencias por enlaces no permitidos o spam.`);
      timeoutApplied = true;
    } catch (error) {
      console.error(`No se pudo aplicar timeout a ${message.author.tag}:`, error);
    }
    const notice = timeoutApplied
      ? `⚠️ <@${message.author.id}> recibió su **${warningLimit}.ª advertencia** y quedó en timeout durante **${Math.ceil(timeoutMs / 60_000)} minutos**. El contador se reinició.`
      : `⚠️ <@${message.author.id}> llegó a **${warningLimit} advertencias**, pero Discord no permitió aplicar el timeout. Revisa los permisos y la jerarquía del bot.`;
    await sendNotice(message, config, notice, true);
    return true;
  }

  const reasonText = reason === 'untrusted_link'
    ? 'el enlace no está en la lista permitida'
    : reason === 'repeated_message'
      ? 'detecté mensajes repetidos'
      : 'detecté demasiados mensajes en poco tiempo';
  await sendNotice(message, config, `<@${message.author.id}>, borré tu mensaje porque ${reasonText}. Advertencia **${warning.count}/${warningLimit}**; al llegar al límite se aplica timeout por **${Math.ceil(timeoutMs / 60_000)} minutos**. Dominios permitidos: ${allowedDomains.join(', ')}.`, false);
  return true;
}

