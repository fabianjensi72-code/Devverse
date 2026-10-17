import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function sendNotice(message, content) {
  const notice = await message.reply({
    content,
    allowedMentions: { parse: [] },
  }).catch((error) => {
    console.error('No se pudo enviar el aviso de moderación:', error);
    return null;
  });
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 10_000).unref?.();
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

  await message.delete().catch((error) => console.error('No se pudo borrar el mensaje moderado:', error));
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
    await sendNotice(message, notice);
    return true;
  }

  const reasonText = reason === 'untrusted_link'
    ? 'el enlace no está en la lista permitida'
    : reason === 'repeated_message'
      ? 'detecté mensajes repetidos'
      : 'detecté demasiados mensajes en poco tiempo';
  await sendNotice(message, `⚠️ <@${message.author.id}>, borré tu mensaje porque ${reasonText}. Advertencia **${warning.count}/${warningLimit}**; al llegar al límite se aplica timeout por **${Math.ceil(timeoutMs / 60_000)} minutos**. Dominios permitidos: ${allowedDomains.join(', ')}.`);
  return true;
}

