import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { addWarning, clearActiveWarnings, logModerationAction, publishModerationWarning } from './moderationStore.js';
const userActivity = new Map();

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
      await publishModerationWarning(message.guild, config, message.author.id,
        `Detecté un mensaje que debía moderarse en <#${message.channelId}>, pero no pude borrarlo porque me falta **Gestionar mensajes** en ese canal. No sumé una advertencia al miembro.`);
      console.error(`Moderación omitida en ${message.channelId}: al bot le falta ManageMessages.`);
      return true;
    }
    await message.delete();
  } catch (error) {
    await publishModerationWarning(message.guild, config, message.author.id,
      `Detecté un mensaje que debía moderarse en <#${message.channelId}>, pero Discord rechazó el borrado. No sumé una advertencia al miembro. Revisa **Gestionar mensajes** y los permisos de la categoría.`)
      .catch((noticeError) => console.error('No se pudo publicar el aviso de permisos:', noticeError));
    console.error('No se pudo borrar el mensaje moderado:', error);
    return true;
  }
  const warningLimit = Math.max(2, Number(security.timeoutAtWarnings ?? 3));
  const expiryMs = Math.max(1, Number(security.warningsExpireAfterDays ?? 30)) * 24 * 60 * 60 * 1000;
  const timeoutMs = Math.max(1, Number(security.timeoutMinutes ?? 10)) * 60 * 1000;
  const allowedDomains = getAllowedDomains(config);
  const warning = await addWarning({
    guildId: message.guild.id,
    userId: message.author.id,
    reason,
    source: 'automod',
    now,
    expiryMs,
    warningLimit,
  });
  await logModerationAction(message.guild, config, {
    userId: message.author.id,
    action: 'Advertencia automática',
    reason,
    channelId: message.channelId,
  });

  if (warning.timedOut) {
    let timeoutApplied = false;
    try {
      await message.member.timeout(timeoutMs, `${warningLimit} advertencias por enlaces no permitidos o spam.`);
      timeoutApplied = true;
    } catch (error) {
      console.error(`No se pudo aplicar timeout a ${message.author.tag}:`, error);
    }
    if (timeoutApplied) {
      await clearActiveWarnings(message.guild.id, message.author.id);
      await logModerationAction(message.guild, config, {
        userId: message.author.id,
        action: 'Timeout automático',
        reason: `${warningLimit} advertencias por enlaces no permitidos o spam`,
        durationMs: timeoutMs,
        channelId: message.channelId,
      });
    }
    const notice = timeoutApplied
      ? `⚠️ <@${message.author.id}> recibió su **${warningLimit}.ª advertencia** y quedó en timeout durante **${Math.ceil(timeoutMs / 60_000)} minutos**. El contador se reinició.`
      : `⚠️ <@${message.author.id}> llegó a **${warningLimit} advertencias**, pero Discord no permitió aplicar el timeout. Revisa los permisos y la jerarquía del bot.`;
    await publishModerationWarning(message.guild, config, message.author.id, notice, true, message.channelId)
      .catch((error) => console.error('No se pudo publicar la sanción automática:', error));
    return true;
  }

  const reasonText = reason === 'untrusted_link'
    ? 'el enlace no está en la lista permitida'
    : reason === 'repeated_message'
      ? 'detecté mensajes repetidos'
      : 'detecté demasiados mensajes en poco tiempo';
  await publishModerationWarning(message.guild, config, message.author.id,
    `<@${message.author.id}>, borré tu mensaje porque ${reasonText}. Advertencia **${warning.count}/${warningLimit}**; al llegar al límite se aplica timeout por **${Math.ceil(timeoutMs / 60_000)} minutos**. Dominios permitidos: ${allowedDomains.join(', ')}.`,
    false,
    message.channelId,
  ).catch((error) => console.error('No se pudo publicar la advertencia automática:', error));
  return true;
}

