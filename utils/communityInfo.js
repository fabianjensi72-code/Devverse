import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../config.json' with { type: 'json' };
import { getTopActiveMembers } from './communityActivity.js';

const staffPattern = /\b(staff|admin(?:istrador(?:es)?)?|moderador(?:es)?|moderaci[oó]n|helper|equipo|owner|dueñ[oa]|founder|fundador(?:a|es)?)\b/i;
const ownerPattern = /\b(owner|dueñ[oa]|fundador(?:a)?|founder)\b/i;
const activityPattern = /\b(m[aá]s activo(?:s|as)?|actividad|participa(?:nte|ci[oó]n)|quien(?:es)? habla(?:n)? m[aá]s|miembro m[aá]s activo)\b/i;

function getStaffRoles(guild) {
  const configured = new Set([
    ...(config.roles?.moderationStaff ?? []),
    ...(config.roles?.ticketNotifyRoles ?? []),
    config.applications?.reviewerRoleId,
  ].filter(Boolean));

  return [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id
      && (configured.has(role.id) || role.permissions.has(PermissionFlagsBits.Administrator)))
    .sort((a, b) => b.position - a.position)
    .slice(0, 12);
}

async function getOwner(guild) {
  const member = guild.members.cache.get(guild.ownerId)
    ?? await guild.members.fetch(guild.ownerId).catch(() => null);
  return member ? `<@${member.id}>` : `<@${guild.ownerId}>`;
}

async function staffLines(guild, question) {
  const lines = [];
  if (ownerPattern.test(question)) lines.push(`**Dueño del servidor:** ${await getOwner(guild)}`);
  if (staffPattern.test(question)) {
    const roles = getStaffRoles(guild);
    if (!roles.length) lines.push('No encontré roles de staff configurados.');
    for (const role of roles) {
      const members = [...role.members.values()].filter((member) => !member.user.bot);
      const names = members.slice(0, 10).map((member) => `<@${member.id}>`);
      lines.push(`**${role.name}:** ${names.length ? names.join(', ') : 'No hay miembros cargados con este rol.'}`);
    }
  }
  return lines;
}

async function activeLines(guild) {
  const top = getTopActiveMembers(guild.id);
  if (!top.length) return ['Todavía no tengo datos suficientes; empezaré a contar mensajes desde que el bot está conectado.'];
  const lines = await Promise.all(top.map(async (entry, index) => {
    const member = guild.members.cache.get(entry.userId)
      ?? await guild.members.fetch(entry.userId).catch(() => null);
    return `${index + 1}. ${member ? `<@${member.id}>` : `Usuario ${entry.userId}`} — **${entry.messages} mensajes**`;
  }));
  return [...lines, '_Cuenta mensajes de los últimos 7 días desde que el bot está conectado; no mide quién aparece online._'];
}

/** Responde directamente a preguntas que requieren datos vivos de roles o actividad. */
export async function replyWithCommunityInfo(message, question) {
  const wantsStaff = staffPattern.test(question);
  const wantsActivity = activityPattern.test(question);
  if (!wantsStaff && !wantsActivity) return false;

  const sections = [];
  if (wantsStaff) sections.push(...await staffLines(message.guild, question));
  if (wantsActivity) sections.push('**Miembros más activos (últimos 7 días):**', ...await activeLines(message.guild));

  await message.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('👥 Comunidad de DevVerse Studios')
      .setDescription(sections.join('\n').slice(0, 4000))
      .setFooter({ text: 'Información calculada con los roles y mensajes que el bot puede observar.' })],
    allowedMentions: { parse: [] },
  });
  return true;
}

