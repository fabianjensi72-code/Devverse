import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.json' with { type: 'json' };
import { summarizeTicketWithGroq } from './groqClient.js';

const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const counterPath = path.join(dataDirectory, 'tickets.json');
const panelTypes = new Set(['soporte', 'reporte', 'bug', 'colab', 'dona']);
const fieldCatalog = {
  soporte: [
    ['titulo', 'Título de la consulta', TextInputStyle.Short, 'Resume el problema en una frase'],
    ['descripcion', 'Descripción detallada', TextInputStyle.Paragraph, 'Incluye los detalles necesarios'],
  ],
  reporte: [
    ['usuario', 'Username del reportado', TextInputStyle.Short, 'Nombre o ID de Discord/Roblox'],
    ['motivo', 'Motivo y pruebas', TextInputStyle.Paragraph, 'Explica qué ocurrió y añade contexto'],
  ],
  bug: [
    ['titulo', 'Título del bug', TextInputStyle.Short, '¿Qué problema encontraste?'],
    ['descripcion', 'Pasos y detalles', TextInputStyle.Paragraph, 'Indica cómo reproducirlo y qué esperabas'],
  ],
  colab: [
    ['tipo', 'Tipo de colaboración', TextInputStyle.Short, 'Scripter, Builder, Sponsor, etc.'],
    ['propuesta', 'Tu propuesta', TextInputStyle.Paragraph, 'Describe el proyecto y lo que buscas'],
  ],
  dona: [
    ['consulta', 'Método o consulta de donación', TextInputStyle.Paragraph, 'Cuéntanos en qué podemos orientarte'],
  ],
};
const typeLabels = {
  soporte: 'Soporte general',
  reporte: 'Reporte de usuario',
  bug: 'Reporte de bug',
  colab: 'Colaboración',
  dona: 'Donaciones',
};
const typeColors = {
  soporte: 0x5865f2,
  reporte: 0xed4245,
  bug: 0xf1c40f,
  colab: 0x3498db,
  dona: 0x2ecc71,
};

let counterQueue = Promise.resolve();
const pendingTicketUsers = new Set();
const ticketCooldowns = new Map();
const claimingTickets = new Set();
const closingTickets = new Set();
const submittedRatings = new Set();
const TICKET_COOLDOWN_MS = Math.max(0, Number(config.cooldowns?.ticketOpenSeconds ?? 60)) * 1000;

async function reserveTicketNumber() {
  const reserve = async () => {
    await mkdir(dataDirectory, { recursive: true });
    let state;
    try {
      state = JSON.parse(await readFile(counterPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { nextTicketNumber: 1 };
    }

    const number = Number.isSafeInteger(state.nextTicketNumber) && state.nextTicketNumber > 0
      ? state.nextTicketNumber
      : 1;
    const temporaryPath = `${counterPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ nextTicketNumber: number + 1 }, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, counterPath);
    return number;
  };

  const current = counterQueue.then(reserve, reserve);
  counterQueue = current.then(() => undefined, () => undefined);
  return current;
}

function makeModal(type) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_form_${type}`)
    .setTitle(`Nuevo ticket • ${typeLabels[type]}`);

  const rows = fieldCatalog[type].map(([id, label, style, placeholder]) => {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setRequired(true)
      .setMaxLength(style === TextInputStyle.Paragraph ? 1500 : 100);
    if (placeholder) input.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(input);
  });

  modal.addComponents(...rows);
  return modal;
}

function getAdminRoles(guild) {
  return guild.roles.cache.filter((role) =>
    role.id !== guild.id && role.permissions.has(PermissionsBitField.Flags.Administrator),
  );
}

function getTicketStaffRoles(guild) {
  const configuredIds = Array.isArray(config.roles?.ticketNotifyRoles)
    ? config.roles.ticketNotifyRoles
    : [];
  return configuredIds.filter((id) => guild.roles.cache.has(id));
}

function isTicketStaff(interaction) {
  const configuredIds = Array.isArray(config.roles?.ticketNotifyRoles)
    ? config.roles.ticketNotifyRoles
    : [];
  const roles = interaction.member?.roles;
  const memberRoleIds = roles?.cache ? [...roles.cache.keys()] : Array.isArray(roles) ? roles : [];
  const hasConfiguredRole = configuredIds.some((id) => memberRoleIds.includes(id));
  return hasConfiguredRole || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function ticketControls(claimed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel(claimed ? '✅ Ticket reclamado' : '🙋 Reclamar ticket')
      .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(claimed),
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('🔒 Cerrar ticket')
      .setStyle(ButtonStyle.Danger),
  );
}

function getClaimedUserId(channel) {
  return channel.topic?.match(/claimed-by:(\d+)/)?.[1] ?? null;
}

function getConversationText(messages, botUserId) {
  const entries = [];
  const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  for (const message of ordered) {
    const author = message.author.id === botUserId ? 'Asistente' : message.member?.displayName ?? message.author.username;
    const parts = [];
    if (message.content?.trim()) {
      parts.push(message.content.trim().replace(/<@!?\d+>/g, '@usuario').replace(/<@&\d+>/g, '@equipo'));
    }
    for (const embed of message.embeds) {
      if (embed.description) parts.push(embed.description);
      for (const field of embed.fields ?? []) parts.push(`${field.name}: ${field.value}`);
    }
    if (message.attachments.size) {
      parts.push(`Adjuntos: ${[...message.attachments.values()].map((file) => file.name).join(', ')}`);
    }
    const text = parts.join(' • ').replace(/\s+/g, ' ').trim();
    if (text) entries.push(`• **${author}**: ${text.slice(0, 240)}`);
  }
  return entries.slice(-20).join('\n').slice(0, 5000) || 'Todavía no hay mensajes para resumir.';
}

function ratingComponents(guildId, channelName, ownerId, claimedUserId) {
  const options = [1, 2, 3, 4, 5].map((score) => ({
    label: `${score} de 5 ${'⭐'.repeat(score)}`,
    value: String(score),
  }));
  const staffMenu = new StringSelectMenuBuilder()
    .setCustomId(`ticket_rating_staff:${guildId}:${channelName}:${ownerId}:${claimedUserId || '0'}`)
    .setPlaceholder('Califica al staff que te atendió')
    .addOptions(options);
  const botMenu = new StringSelectMenuBuilder()
    .setCustomId(`ticket_rating_bot:${guildId}:${channelName}:${ownerId}:${claimedUserId || '0'}`)
    .setPlaceholder('Califica al asistente del bot')
    .addOptions(options);

  return [
    new ActionRowBuilder().addComponents(staffMenu),
    new ActionRowBuilder().addComponents(botMenu),
  ];
}

async function sendTicketLog(guild, channel, closedBy) {
  const logChannelId = config.channels?.ticketLogChannelId || '1502430789936218213';
  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel?.isTextBased() || typeof logChannel.send !== 'function') {
    throw new Error(`No se encontró el canal privado de logs ${logChannelId}.`);
  }

  const messages = await channel.messages.fetch({ limit: 100 });
  const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const transcriptLines = [
    `Transcript de ${channel.name}`,
    `Servidor: ${guild.name} (${guild.id})`,
    `Canal: ${channel.id}`,
    `Cerrado por: ${closedBy.tag} (${closedBy.id})`,
    `Fecha: ${new Date().toISOString()}`,
    '',
  ];

  for (const message of ordered) {
    const timestamp = new Date(message.createdTimestamp).toISOString();
    const parts = [message.content?.trim()].filter(Boolean);
    for (const embed of message.embeds) {
      if (embed.title) parts.push(`[${embed.title}]`);
      if (embed.description) parts.push(embed.description);
      for (const field of embed.fields ?? []) parts.push(`${field.name}: ${field.value}`);
    }
    for (const file of message.attachments.values()) parts.push(`[Adjunto: ${file.name} — ${file.url}]`);
    if (parts.length) transcriptLines.push(`[${timestamp}] ${message.author.tag}: ${parts.join(' | ')}`);
  }

  const ownerId = channel.topic?.match(/ticket-owner:(\d+)/)?.[1] ?? 'desconocido';
  const claimedUserId = getClaimedUserId(channel);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🗃️ Ticket archivado • ${channel.name}`)
    .addFields(
      { name: 'Usuario', value: ownerId === 'desconocido' ? ownerId : `<@${ownerId}>`, inline: true },
      { name: 'Atendido por', value: claimedUserId ? `<@${claimedUserId}>` : 'Sin reclamar', inline: true },
      { name: 'Cerrado por', value: `<@${closedBy.id}>`, inline: true },
      { name: 'Mensajes guardados', value: String(ordered.length), inline: true },
    )
    .setTimestamp();
  const attachment = new AttachmentBuilder(
    Buffer.from(transcriptLines.join('\n').slice(0, 1_000_000), 'utf8'),
    { name: `${channel.name}-transcript.txt` },
  );
  await logChannel.send({ embeds: [embed], files: [attachment] });
  return { ownerId, claimedUserId };
}

async function sendRatingRequest(guild, ticketChannel, ownerId, claimedUserId) {
  const message = {
    embeds: [new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('⭐ ¿Cómo fue la atención?')
      .setDescription(
        `Tu ticket **${ticketChannel.name}** se cerró. Ayúdanos con dos calificaciones: una para ${claimedUserId ? `<@${claimedUserId}>` : 'el equipo de soporte'} y otra para el asistente del bot.`,
      )
      .setFooter({ text: 'Tu opinión se enviará al registro privado del equipo.' })],
    components: ratingComponents(guild.id, ticketChannel.name, ownerId, claimedUserId),
    allowedMentions: { users: claimedUserId ? [claimedUserId] : [], roles: [] },
  };

  const member = await guild.members.fetch(ownerId).catch(() => null);
  if (member) {
    try {
      await member.send(message);
      return 'dm';
    } catch {
      // Si los mensajes directos están cerrados, dejamos la encuesta un minuto en el ticket.
    }
  }
  await ticketChannel.send({
    content: `<@${ownerId}> no pude enviarte la encuesta por DM; puedes calificar aquí antes de que se elimine el ticket.`,
    ...message,
    allowedMentions: { users: [ownerId], roles: [] },
  });
  return 'channel';
}

async function createTicket(interaction, type) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Los tickets solo se pueden abrir dentro del servidor.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const userId = interaction.user.id;
  if (pendingTicketUsers.has(userId)) {
    await interaction.reply({ content: 'Ya estoy creando tu ticket. Espera un momento antes de intentarlo otra vez.', ephemeral: true });
    return;
  }

  const now = Date.now();
  for (const [id, expiresAt] of ticketCooldowns) {
    if (expiresAt <= now) ticketCooldowns.delete(id);
  }
  const expiresAt = ticketCooldowns.get(userId) ?? 0;
  const waitSeconds = Math.ceil((expiresAt - now) / 1000);
  if (waitSeconds > 0) {
    await interaction.reply({ content: `Espera ${waitSeconds} segundos antes de abrir otro ticket.`, ephemeral: true });
    return;
  }

  pendingTicketUsers.add(userId);
  try {
    await interaction.deferReply({ ephemeral: true });
    const adminRoles = getAdminRoles(guild);
    const ticketStaffRoleIds = getTicketStaffRoles(guild);
    const botMember = guild.members.me ?? await guild.members.fetchMe();
    const parentId = config.channels?.ticketCategoryId || config.channels?.supportCategoryId || null;
    let parent;

    if (parentId) {
      parent = await guild.channels.fetch(parentId).catch(() => null);
      if (!parent || parent.type !== ChannelType.GuildCategory) {
        await interaction.editReply('La categoría de tickets configurada no existe o no es una categoría. Avísale al Staff.');
        return;
      }
    }

    const number = await reserveTicketNumber();
    const channelName = `ticket-${String(number).padStart(3, '0')}`;

    const overwrites = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      },
      {
        id: botMember.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels],
      },
      ...[...new Set([...adminRoles.keys(), ...ticketStaffRoleIds])].map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
    ];

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      ...(parent ? { parent: parent.id } : {}),
      topic: `ticket-owner:${interaction.user.id} type:${type}`,
      permissionOverwrites: overwrites,
      reason: `Ticket ${number} (${typeLabels[type]}) abierto por ${interaction.user.tag}`,
    });

    const answers = fieldCatalog[type].map(([id, label]) => ({
      name: label,
      value: interaction.fields.getTextInputValue(id).trim().slice(0, 1024) || '—',
      inline: false,
    }));
    const embed = new EmbedBuilder()
      .setColor(typeColors[type])
      .setAuthor({ name: `DEVVERSE STUDIOS • ${typeLabels[type].toUpperCase()}`, iconURL: interaction.client.user.displayAvatarURL() })
      .setTitle(`📩 ${channelName}`)
      .setDescription(`**Solicitud de <@${userId}>**\nEl equipo administrativo revisará los detalles y responderá aquí.`)
      .addFields(...answers)
      .setFooter({ text: 'No compartas contraseñas ni claves API • DevVerse Studios' })
      .setTimestamp();
    const staffMention = ticketStaffRoleIds.length
      ? ticketStaffRoleIds.map((id) => `<@&${id}>`).join(' ')
      : '**Equipo de soporte**';

    await channel.send({
      content: `📬 **Nueva solicitud** • <@${userId}> • ${staffMention}\nGracias por escribirnos. Añade aquí cualquier información que ayude al equipo a atenderte.`,
      embeds: [embed],
      components: [ticketControls()],
      allowedMentions: { users: [userId], roles: ticketStaffRoleIds },
    });
    const cooldownExpiry = Date.now() + TICKET_COOLDOWN_MS;
    if (TICKET_COOLDOWN_MS > 0) ticketCooldowns.set(userId, cooldownExpiry);
    await interaction.editReply(`Tu ticket está listo: <#${channel.id}>. El equipo te atenderá allí.`);
  } finally {
    pendingTicketUsers.delete(userId);
  }
}

async function claimTicket(interaction) {
  const channel = interaction.channel;
  const ownerId = channel?.topic?.match(/ticket-owner:(\d+)/)?.[1];
  if (!channel || channel.type !== ChannelType.GuildText || !ownerId) {
    await interaction.reply({ content: 'Este botón solo funciona dentro de un ticket activo.', ephemeral: true });
    return;
  }
  if (!isTicketStaff(interaction)) {
    await interaction.reply({ content: 'Solo los roles de soporte autorizados pueden reclamar este ticket.', ephemeral: true });
    return;
  }
  const alreadyClaimedBy = getClaimedUserId(channel);
  if (alreadyClaimedBy) {
    await interaction.reply({ content: `Este ticket ya fue reclamado por <@${alreadyClaimedBy}>.`, ephemeral: true, allowedMentions: { users: [alreadyClaimedBy] } });
    return;
  }
  if (claimingTickets.has(channel.id)) {
    await interaction.reply({ content: 'Alguien está reclamando este ticket en este momento.', ephemeral: true });
    return;
  }

  claimingTickets.add(channel.id);
  try {
    await interaction.deferReply({ ephemeral: true });
    await channel.setTopic(`${channel.topic} claimed-by:${interaction.user.id}`.slice(0, 1024));
    const messages = await channel.messages.fetch({ limit: 30 });
    const conversation = getConversationText(messages, interaction.client.user.id);
    const requesterName = messages.find((message) => message.author.id === ownerId)?.member?.displayName
      ?? messages.find((message) => message.author.id === ownerId)?.author.username
      ?? 'el usuario';
    const staffName = interaction.member?.displayName ?? interaction.user.username;
    let summary;
    try {
      summary = await summarizeTicketWithGroq(conversation, requesterName, staffName);
    } catch (error) {
      console.error('No se pudo redactar el resumen del ticket con Groq; usaré un resumen local:', error);
      summary = conversation === 'Todavía no hay mensajes para resumir.'
        ? conversation
        : `El usuario explicó su solicitud en el formulario y la conversación reciente incluye: ${conversation.replace(/\n/g, ' ').slice(0, 900)}`;
    }
    await interaction.message.edit({ components: [ticketControls(true)] }).catch((error) => {
      console.error('No se pudo actualizar el botón de reclamo:', error);
    });

    const summaryEmbed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('🙋 Ticket reclamado')
      .setDescription(`<@${interaction.user.id}> se hará cargo de esta solicitud.\n\n**Resumen para el staff**\nHola <@${interaction.user.id}>: <@${ownerId}> ${summary}`)
      .setFooter({ text: `Ticket ${channel.name} • DevVerse Studios` })
      .setTimestamp();
    await channel.send({
      content: `<@${ownerId}> • <@${interaction.user.id}> ya está atendiendo tu ticket.`,
      embeds: [summaryEmbed],
      allowedMentions: { users: [ownerId, interaction.user.id], roles: [] },
    });
    await interaction.editReply(`Reclamaste el ticket ${channel.name}.`);
  } finally {
    claimingTickets.delete(channel.id);
  }
}

async function closeTicket(interaction) {
  const channel = interaction.channel;
  const ownerId = channel?.topic?.match(/ticket-owner:(\d+)/)?.[1];
  if (!channel || channel.type !== ChannelType.GuildText || !ownerId) {
    await interaction.reply({ content: 'Este botón solo funciona dentro de un canal de ticket.', ephemeral: true });
    return;
  }

  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== ownerId && !isAdmin && !isTicketStaff(interaction)) {
    await interaction.reply({ content: 'Solo quien abrió el ticket o el equipo de soporte puede cerrarlo.', ephemeral: true });
    return;
  }
  if (closingTickets.has(channel.id)) {
    await interaction.reply({ content: 'Este ticket ya se está cerrando.', ephemeral: true });
    return;
  }

  closingTickets.add(channel.id);
  try {
    await interaction.deferReply({ ephemeral: true });
    let ticketInfo;
    try {
      ticketInfo = await sendTicketLog(interaction.guild, channel, interaction.user);
    } catch (error) {
      console.error('No se pudo guardar el transcript del ticket:', error);
      await interaction.editReply('No pude guardar el transcript en el canal privado de logs, así que dejé el ticket abierto. Revisa los permisos y vuelve a cerrarlo.');
      closingTickets.delete(channel.id);
      return;
    }

    let ratingDelivery = 'unavailable';
    if (ticketInfo.ownerId !== 'desconocido') {
      ratingDelivery = await sendRatingRequest(interaction.guild, channel, ticketInfo.ownerId, ticketInfo.claimedUserId)
        .catch((error) => {
          console.error('No se pudo enviar la encuesta de satisfacción:', error);
          return 'unavailable';
        });
    }
    const delayMs = ratingDelivery === 'channel' ? 60_000 : 5000;
    const delayText = ratingDelivery === 'channel' ? '60 segundos' : '5 segundos';
    const deliveryText = ratingDelivery === 'dm'
      ? 'envié la encuesta por DM'
      : ratingDelivery === 'channel'
        ? 'dejé la encuesta en este canal porque no pude enviar DM'
        : 'no pude enviar la encuesta, pero el transcript quedó guardado';
    await interaction.editReply(`Guardé el transcript en logs y ${deliveryText}. El canal se eliminará en ${delayText}.`);
    setTimeout(() => {
      channel.delete(`Ticket cerrado por ${interaction.user.tag}`).catch((error) => {
        console.error('No se pudo eliminar el canal del ticket:', error);
      }).finally(() => {
        closingTickets.delete(channel.id);
        submittedRatings.delete(`${interaction.guildId}:${channel.name}:staff`);
        submittedRatings.delete(`${interaction.guildId}:${channel.name}:bot`);
      });
    }, delayMs).unref?.();
  } catch (error) {
    closingTickets.delete(channel.id);
    throw error;
  }
}

async function handleTicketRating(interaction) {
  const match = interaction.customId.match(/^ticket_rating_(staff|bot):(\d+):([\w-]+):(\d+):(\d+)$/);
  if (!match) return false;

  const [, category, guildId, ticketName, ownerId, claimedUserId] = match;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Esta encuesta pertenece a otra persona.', ephemeral: true });
    return true;
  }
  const score = Number(interaction.values[0]);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    await interaction.reply({ content: 'Selecciona una calificación del 1 al 5.', ephemeral: true });
    return true;
  }

  const ratingKey = `${guildId}:${ticketName}:${category}`;
  if (submittedRatings.has(ratingKey)) {
    await interaction.reply({ content: 'Ya recibimos esta calificación. ¡Gracias!', ephemeral: true });
    return true;
  }
  submittedRatings.add(ratingKey);
  await interaction.deferReply({ ephemeral: true });
  try {
    const guild = interaction.client.guilds.cache.get(guildId)
      ?? await interaction.client.guilds.fetch(guildId);
    const logChannelId = config.channels?.ticketLogChannelId || '1502430789936218213';
    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel?.isTextBased() || typeof logChannel.send !== 'function') {
      throw new Error(`No se encontró el canal privado de logs ${logChannelId}.`);
    }

    const subject = category === 'staff'
      ? `al staff ${claimedUserId === '0' ? 'de soporte' : `<@${claimedUserId}>`}`
      : 'al asistente del bot';
    await logChannel.send({
      content: `⭐ Calificación **${score}/5** ${subject} para **${ticketName}** • enviada por <@${ownerId}>.`,
      allowedMentions: { users: [ownerId, ...(claimedUserId !== '0' ? [claimedUserId] : [])], roles: [] },
    });
    await interaction.editReply('¡Gracias! Guardé tu calificación en el registro privado. ⭐');
  } catch (error) {
    submittedRatings.delete(ratingKey);
    console.error('No se pudo guardar la calificación del ticket:', error);
    await interaction.editReply('No pude registrar tu calificación. Inténtalo de nuevo en un momento.');
  }
}

export async function handleTicketInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_rating_')) {
    return handleTicketRating(interaction);
  }
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;

  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
    const type = interaction.customId.slice('ticket_'.length);
    if (!panelTypes.has(type)) return false;
    await interaction.showModal(makeModal(type));
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_form_')) {
    const type = interaction.customId.slice('ticket_form_'.length);
    if (!panelTypes.has(type)) {
      await interaction.reply({ content: 'No reconozco este formulario. Vuelve a abrirlo desde el panel.', ephemeral: true });
      return true;
    }
    await createTicket(interaction, type);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await closeTicket(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'claim_ticket') {
    await claimTicket(interaction);
    return true;
  }

  return false;
}

