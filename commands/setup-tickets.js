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
const ticketCooldownSeconds = Number(config.cooldowns?.ticketOpenSeconds ?? 60);

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
      .setAuthor({
        name: 'DEVVERSE STUDIOS • SOPORTE',
        iconURL: interaction.client.user.displayAvatarURL(),
      })
      .setTitle('📩 Centro de Soporte y Atención')
      .setDescription(
        'Abre una solicitud privada con el equipo de **DevVerse Studios**. Selecciona el tema y completa el formulario para que podamos ayudarte con contexto.',
      )
      .addFields(
        { name: '🆘 Ayuda y reportes', value: 'Soporte general, reportar usuarios o avisar de errores del juego.', inline: true },
        { name: '🤝 Comunidad', value: 'Propuestas de colaboración y consultas de donación.', inline: true },
        { name: '🔐 Privacidad', value: 'El canal será visible para ti y el equipo administrativo. Nunca compartas contraseñas ni claves API.', inline: false },
      )
      .setThumbnail(interaction.client.user.displayAvatarURL())
      .setFooter({ text: `Elige una opción • Espera ${ticketCooldownSeconds} s entre solicitudes` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      ...ticketButtons.map(([customId, label, style]) =>
        new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style),
      ),
    );

    await channel.send({
      content: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      embeds: [embed],
      components: [row],
    });
    await interaction.reply({ content: `Panel de tickets publicado en <#${channel.id}>.`, ephemeral: true });
  },
};

