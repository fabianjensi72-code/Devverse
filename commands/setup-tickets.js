import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import config from '../config.json' with { type: 'json' };

const ticketButtons = [
  ['ticket_soporte', '🆘 Soporte general', ButtonStyle.Danger],
  ['ticket_reporte', '🚨 Reportar usuario', ButtonStyle.Danger],
  ['ticket_bug', '🐞 Reportar bug', ButtonStyle.Danger],
  ['ticket_colab', '🤝 Colaboraciones', ButtonStyle.Primary],
  ['ticket_dona', '💸 Donaciones', ButtonStyle.Success],
];

export default {
  data: new SlashCommandBuilder()
    .setName('setup-tickets')
    .setDescription('Publica el panel de soporte de DevVerse Studios.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Solo un administrador puede publicar el panel.', ephemeral: true });
      return;
    }

    const channelId = config.channels?.ticketChannelId || config.channels?.createTicket || '1502442612127436960';
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: 'No encuentro el canal de texto configurado para el panel de tickets.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📩 Centro de Soporte y Atención')
      .setDescription(
        '¿Necesitas ayuda del equipo de DevVerse Studios? Elige una opción para abrir un ticket privado. ' +
        'Cuéntanos los detalles en el formulario y un administrador te atenderá lo antes posible.\n\n' +
        '🔒 Solo tú y el equipo administrativo podrán ver el canal de tu ticket.',
      )
      .setFooter({ text: 'DevVerse Studios • Centro de soporte' });

    const row = new ActionRowBuilder().addComponents(
      ...ticketButtons.map(([customId, label, style]) =>
        new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style),
      ),
    );

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `Panel de tickets publicado en <#${channel.id}>.`, ephemeral: true });
  },
};
