import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getModerationHistory } from '../utils/moderationStore.js';
import { isModerationStaff } from '../utils/moderationCommands.js';

export default {
  data: new SlashCommandBuilder()
    .setName('historial')
    .setDescription('Consulta advertencias y sanciones recientes de un miembro.')
    .addUserOption((option) => option.setName('miembro').setDescription('Miembro cuyo historial quieres consultar.').setRequired(true)),

  async execute(interaction) {
    if (!interaction.inGuild() || !isModerationStaff(interaction)) {
      await interaction.reply({ content: 'Necesitas un rol de moderación o el permiso Gestionar mensajes.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('miembro', true);
    const history = await getModerationHistory(interaction.guildId, target.id, 10);
    const entries = [
      ...history.warnings.map((entry) => ({ ...entry, kind: 'Advertencia', at: entry.at })),
      ...history.actions.map((entry) => ({ ...entry, kind: entry.action, at: entry.at })),
    ].sort((a, b) => b.at - a.at).slice(0, 10);

    const description = entries.length
      ? entries.map((entry) => {
        const when = Math.floor(entry.at / 1000);
        const staff = entry.moderatorId ? `<@${entry.moderatorId}>` : 'AutoMod';
        return `• <t:${when}:R> **${entry.kind}** — ${staff}\n  ${String(entry.reason || 'Sin motivo').slice(0, 180)}`;
      }).join('\n')
      : 'No hay advertencias ni acciones registradas para este miembro.';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📜 Historial de ${target.tag}`)
      .setDescription(description.slice(0, 4000))
      .addFields({ name: 'Advertencias activas', value: String(history.activeWarnings.length), inline: true })
      .setFooter({ text: 'Solo visible para el staff • Se conservan hasta 100 acciones por miembro' })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};

