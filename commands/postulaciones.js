import { SlashCommandBuilder } from 'discord.js';
import { publishApplicationPanel, setApplicationsOpen } from '../utils/applicationHandler.js';
import config from '../config.json' with { type: 'json' };

export default {
  data: new SlashCommandBuilder()
    .setName('postulaciones')
    .setDescription('Publica el panel o abre y cierra las postulaciones.')
    .addSubcommand((subcommand) => subcommand.setName('panel').setDescription('Publica el panel en este canal, inicialmente cerrado.'))
    .addSubcommand((subcommand) => subcommand.setName('abrir').setDescription('Abre las postulaciones y activa el botón del panel.'))
    .addSubcommand((subcommand) => subcommand.setName('cerrar').setDescription('Cierra las postulaciones y desactiva el botón.')),

  async execute(interaction) {
    const isOwner = interaction.inGuild() && interaction.user.id === interaction.guild.ownerId;
    const isFounder = interaction.member?.roles?.cache?.has(config.applications.reviewerRoleId);
    if (!interaction.inGuild() || (!isOwner && !isFounder)) {
      await interaction.reply({ content: 'Solo el Founder puede configurar y abrir las postulaciones.', ephemeral: true });
      return;
    }
    const action = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });
    try {
      if (action === 'panel') {
        const message = await publishApplicationPanel(interaction);
        await interaction.editReply(`Panel publicado en <#${message.channelId}> y cerrado por ahora.`);
        return;
      }
      const enabled = action === 'abrir';
      await setApplicationsOpen(interaction.guild, enabled);
      await interaction.editReply(enabled ? 'Postulaciones abiertas. El botón del panel ya está activo.' : 'Postulaciones cerradas. El botón del panel quedó desactivado.');
    } catch (error) {
      console.error('No se pudo actualizar el panel de postulaciones:', error);
      await interaction.editReply('No pude actualizar las postulaciones. Publica primero `/postulaciones panel` en el canal deseado.');
    }
  },
};

