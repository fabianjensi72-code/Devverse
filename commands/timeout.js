import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { logModerationAction } from '../utils/moderationStore.js';
import { isModerationStaff, moderationConfig } from '../utils/moderationCommands.js';

export default {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Aplica timeout temporal a un miembro.')
    .addUserOption((option) => option.setName('miembro').setDescription('Miembro que recibirá timeout.').setRequired(true))
    .addIntegerOption((option) => option.setName('minutos').setDescription('Duración entre 1 y 40320 minutos.').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((option) => option.setName('motivo').setDescription('Motivo de la sanción.').setRequired(true).setMaxLength(400)),

  async execute(interaction) {
    if (!interaction.inGuild() || !isModerationStaff(interaction, 'timeout')) {
      await interaction.reply({ content: 'Necesitas un rol autorizado o el permiso Moderar miembros.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('miembro', true);
    const minutes = interaction.options.getInteger('minutos', true);
    const reason = interaction.options.getString('motivo', true).trim();
    try {
      const member = await interaction.guild.members.fetch(target.id);
      await member.timeout(minutes * 60_000, reason);
      await logModerationAction(interaction.guild, moderationConfig(), {
        userId: target.id,
        moderatorId: interaction.user.id,
        action: 'Timeout manual',
        reason,
        durationMs: minutes * 60_000,
      });
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription(`<@${target.id}> recibió timeout durante **${minutes} minutos**. Motivo: ${reason}`)
        .setTimestamp()] });
    } catch (error) {
      console.error('No se pudo aplicar el timeout:', error);
      await interaction.editReply('No pude aplicar el timeout. Revisa que el miembro esté en el servidor y que mi rol esté por encima del suyo.');
    }
  },
};

