import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmbedBuilder } from 'discord.js';

const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const statePath = path.join(dataDirectory, 'message-warnings.json');
let queue = Promise.resolve();

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { users: {}, actions: {} };
  }
}

function normalizeRecord(raw) {
  if (Array.isArray(raw)) return { active: raw, history: raw.map((entry) => ({ ...entry, source: 'automod' })) };
  return { active: raw?.active ?? [], history: raw?.history ?? [] };
}

function updateState(callback) {
  const operation = queue.then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    const state = await readState();
    const result = await callback(state);
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, statePath);
    return result;
  });
  queue = operation.then(() => undefined, () => undefined);
  return operation;
}

function keyFor(guildId, userId) {
  return `${guildId}:${userId}`;
}

export function addWarning({ guildId, userId, moderatorId = null, reason, source = 'manual', now = Date.now(), expiryMs = 30 * 86400_000, warningLimit = 3 }) {
  return updateState((state) => {
    state.users ??= {};
    const key = keyFor(guildId, userId);
    const record = normalizeRecord(state.users[key]);
    record.history = record.history.slice(-99);
    record.active = record.active.filter((entry) => now - entry.at < expiryMs);
    const entry = { reason, source, moderatorId, at: now };
    record.active.push(entry);
    record.history.push(entry);
    state.users[key] = record;
    return { count: record.active.length, timedOut: record.active.length >= warningLimit };
  });
}

export function clearActiveWarnings(guildId, userId) {
  return updateState((state) => {
    state.users ??= {};
    const key = keyFor(guildId, userId);
    const record = normalizeRecord(state.users[key]);
    const cleared = record.active.length;
    record.active = [];
    state.users[key] = record;
    return cleared;
  });
}

export async function getModerationHistory(guildId, userId, limit = 10) {
  await queue;
  const state = await readState();
  const record = normalizeRecord(state.users?.[keyFor(guildId, userId)]);
  const actions = state.actions?.[keyFor(guildId, userId)] ?? [];
  return {
    activeWarnings: record.active,
    warnings: record.history.slice(-limit).reverse(),
    actions: actions.slice(-limit).reverse(),
  };
}

export function recordModerationAction({ guildId, userId, moderatorId, action, reason, durationMs = null, channelId = null, at = Date.now() }) {
  return updateState((state) => {
    state.actions ??= {};
    const key = keyFor(guildId, userId);
    state.actions[key] ??= [];
    state.actions[key].push({ action, reason, moderatorId, durationMs, channelId, at });
    state.actions[key] = state.actions[key].slice(-100);
  });
}

export async function publishModerationWarning(guild, config, userId, description, isTimeout = false, incidentChannelId = null) {
  const channelId = config.security?.warningChannelId;
  if (!channelId) throw new Error('No está configurado security.warningChannelId.');
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || typeof channel.send !== 'function') throw new Error(`El canal de advertencias ${channelId} no admite mensajes.`);
  const embed = new EmbedBuilder()
    .setColor(isTimeout ? 0xe74c3c : 0xf1c40f)
    .setTitle(isTimeout ? '⛔ Sanción aplicada' : '⚠️ Advertencia de moderación')
    .setDescription(description)
    .addFields(
      { name: 'Miembro', value: `<@${userId}>`, inline: true },
      ...(incidentChannelId ? [{ name: 'Canal del incidente', value: `<#${incidentChannelId}>`, inline: true }] : []),
    )
    .setFooter({ text: 'DevVerse Studios • Moderación automática' })
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { users: [userId] } });
}

export async function logModerationAction(guild, config, details) {
  await recordModerationAction({ guildId: guild.id, ...details });
  const channelId = config.channels?.moderationLogChannelId || config.channels?.ticketLogChannelId;
  if (!channelId) {
    console.error('No se registró la acción en Discord: configura channels.moderationLogChannelId.');
    return;
  }
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') throw new Error(`El canal ${channelId} no admite mensajes.`);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📋 Moderación • ${details.action}`)
      .addFields(
        { name: 'Miembro', value: `<@${details.userId}> (\`${details.userId}\`)`, inline: true },
        { name: 'Staff', value: details.moderatorId ? `<@${details.moderatorId}>` : 'AutoMod', inline: true },
        { name: 'Motivo', value: String(details.reason || 'Sin motivo').slice(0, 1024) },
      )
      .setTimestamp(details.at ? new Date(details.at) : new Date());
    if (details.durationMs) embed.addFields({ name: 'Duración', value: `${Math.ceil(details.durationMs / 60_000)} min`, inline: true });
    if (details.channelId) embed.addFields({ name: 'Canal', value: `<#${details.channelId}>`, inline: true });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(`No se pudo publicar la acción de moderación en ${channelId}:`, error);
  }
}

