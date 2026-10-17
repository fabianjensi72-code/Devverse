import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { logModerationAction } from '../utils/moderationStore.js';
import { isModerationStaff, moderationConfig } from '../utils/moderationCommands.js';

export default {
  data: new SlashCommandBuilder()
    .setName('limpiar')
    .setDescription('Borra mensajes recientes del canal actual.')
    .addIntegerOption((option) => option.setName('cantidad').setDescription('Cantidad de mensajes, entre 1 y 100.').setRequired(true).setMinValue(1).setMaxValue(100)),

  async execute(interaction) {
    if (!interaction.inGuild() || !isModerationStaff(interaction)) {
      await interaction.reply({ content: 'Necesitas un rol de moderación o el permiso Gestionar mensajes.', ephemeral: true });
      return;
    }
    const amount = interaction.options.getInteger('cantidad', true);
    await interaction.deferReply({ ephemeral: true });
    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await logModerationAction(interaction.guild, moderationConfig(), {
        userId: interaction.user.id,
        moderatorId: interaction.user.id,
        action: 'Limpieza de mensajes',
        reason: `Se solicitaron ${amount}; Discord borró ${deleted.size}.`,
        channelId: interaction.channelId,
      });
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(`🧹 Borré **${deleted.size}** mensajes recientes. Discord omite mensajes con más de 14 días.`)
        .setTimestamp()] });
    } catch (error) {
      console.error('No se pudieron limpiar los mensajes:', error);
      await interaction.editReply('No pude borrar mensajes aquí. Revisa mi permiso **Gestionar mensajes** en este canal.');
    }
  },
};

