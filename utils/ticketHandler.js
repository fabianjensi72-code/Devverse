import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.json' with { type: 'json' };

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

let counterQueue = Promise.resolve();

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

async function createTicket(interaction, type) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Los tickets solo se pueden abrir dentro del servidor.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const adminRoles = getAdminRoles(guild);
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
    ...adminRoles.map((role) => ({
      id: role.id,
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
    .setColor(0x5865f2)
    .setTitle(`📩 ${typeLabels[type]} • ${channelName}`)
    .setDescription(`Ticket abierto por <@${interaction.user.id}>. El equipo administrativo revisará la solicitud.`)
    .addFields(...answers)
    .setFooter({ text: 'DevVerse Studios • Centro de soporte' })
    .setTimestamp();
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('🔒 Cerrar Ticket')
      .setStyle(ButtonStyle.Secondary),
  );
  const roleMentions = [...adminRoles.keys()];
  const staffMention = roleMentions.length ? roleMentions.map((id) => `<@&${id}>`).join(' ') : 'equipo administrativo';

  await channel.send({
    content: `<@${interaction.user.id}> • ${staffMention}\nGracias por contactar al equipo. Describe cualquier información adicional aquí; cerraremos este canal cuando la atención termine.`,
    embeds: [embed],
    components: [closeRow],
    allowedMentions: { users: [interaction.user.id], roles: roleMentions },
  });
  await interaction.editReply(`Tu ticket está listo: <#${channel.id}>. El equipo te atenderá allí.`);
}

async function closeTicket(interaction) {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: 'Este botón solo funciona dentro de un canal de ticket.', ephemeral: true });
    return;
  }

  const ownerId = channel.topic?.match(/ticket-owner:(\\d+)/)?.[1];
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== ownerId && !isAdmin) {
    await interaction.reply({ content: 'Solo quien abrió el ticket o un administrador puede cerrarlo.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: '🔒 Ticket cerrado. El canal se eliminará en 5 segundos.', ephemeral: true });
  setTimeout(() => {
    channel.delete(`Ticket cerrado por ${interaction.user.tag}`).catch((error) => {
      console.error('No se pudo eliminar el canal del ticket:', error);
    });
  }, 5000).unref?.();
}

export async function handleTicketInteraction(interaction) {
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

  return false;
}
