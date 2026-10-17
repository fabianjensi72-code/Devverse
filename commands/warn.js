import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { addWarning, clearActiveWarnings, logModerationAction, publishModerationWarning } from '../utils/moderationStore.js';
import { isModerationStaff, moderationConfig } from '../utils/moderationCommands.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Advierte a un miembro y guarda el registro.')
    .addUserOption((option) => option.setName('miembro').setDescription('Miembro que recibirá la advertencia.').setRequired(true))
    .addStringOption((option) => option.setName('motivo').setDescription('Motivo de la advertencia.').setRequired(true).setMaxLength(400)),

  async execute(interaction) {
    if (!interaction.inGuild() || !isModerationStaff(interaction)) {
      await interaction.reply({ content: 'Necesitas un rol de moderación o el permiso Gestionar mensajes.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('miembro', true);
    const reason = interaction.options.getString('motivo', true).trim();
    const settings = moderationConfig().security ?? {};
    const warningLimit = Math.max(2, Number(settings.timeoutAtWarnings ?? 3));
    const timeoutMs = Math.max(1, Number(settings.timeoutMinutes ?? 10)) * 60_000;
    const warning = await addWarning({
      guildId: interaction.guildId,
      userId: target.id,
      moderatorId: interaction.user.id,
      reason,
      source: 'manual',
      expiryMs: Math.max(1, Number(settings.warningsExpireAfterDays ?? 30)) * 86_400_000,
      warningLimit,
    });
    await logModerationAction(interaction.guild, moderationConfig(), {
      userId: target.id,
      moderatorId: interaction.user.id,
      action: 'Advertencia manual',
      reason,
    });

    let timedOut = false;
    if (warning.timedOut) {
      try {
        const member = await interaction.guild.members.fetch(target.id);
        await member.timeout(timeoutMs, `${warningLimit} advertencias acumuladas.`);
        timedOut = true;
        await clearActiveWarnings(interaction.guildId, target.id);
        await logModerationAction(interaction.guild, moderationConfig(), {
          userId: target.id,
          moderatorId: interaction.user.id,
          action: 'Timeout por advertencias',
          reason: `${warningLimit} advertencias acumuladas: ${reason}`,
          durationMs: timeoutMs,
        });
      } catch (error) {
        console.error('No se pudo aplicar timeout al alcanzar el límite de advertencias:', error);
      }
    }

    const publicText = warning.timedOut
      ? timedOut
        ? `<@${target.id}> recibió su **${warningLimit}.ª advertencia** y quedó en timeout por **${Math.ceil(timeoutMs / 60_000)} minutos**. El contador se reinició. Motivo: ${reason}`
        : `<@${target.id}> llegó a **${warningLimit} advertencias**, pero Discord no permitió el timeout. Motivo de esta advertencia: ${reason}`
      : `<@${target.id}> recibió una advertencia (**${warning.count}/${warningLimit}**). Motivo: ${reason}`;
    await publishModerationWarning(interaction.guild, moderationConfig(), target.id, publicText, timedOut)
      .catch((error) => console.error('No se pudo publicar la advertencia manual:', error));

    const result = new EmbedBuilder()
      .setColor(timedOut ? 0xe74c3c : 0xf1c40f)
      .setDescription(timedOut
        ? `Advertencia guardada. <@${target.id}> también recibió timeout por 10 minutos.`
        : `Advertencia guardada para <@${target.id}>. Lleva **${warning.count}/${warningLimit}** advertencias activas.`)
      .setTimestamp();
    await interaction.editReply({ embeds: [result] });
  },
};

