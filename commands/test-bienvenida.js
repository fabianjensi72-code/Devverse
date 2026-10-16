import { SlashCommandBuilder } from 'discord.js';
import { createWelcomeCard, createWelcomePayload, getWelcomeChannelId, sendRulesWelcome } from '../utils/welcomeMessage.js';

export default {
  data: new SlashCommandBuilder()
    .setName('test-bienvenida')
    .setDescription('Previsualiza la tarjeta de bienvenida de DevVerse Studios.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const attachment = await createWelcomeCard(interaction.user);
      const payload = {
        ...createWelcomePayload(interaction.user, interaction.guildId),
        files: [attachment],
      };

      // La previsualización va al canal configurado; si no se configuró, se muestra aquí de forma efímera.
      const welcomeChannelId = getWelcomeChannelId();
      if (welcomeChannelId) {
        const channel = await interaction.guild.channels.fetch(welcomeChannelId);
        if (!channel?.isTextBased() || !channel.send) {
          throw new Error(`El canal de bienvenida ${welcomeChannelId} no existe o no admite mensajes.`);
        }
        await channel.send(payload);
        await sendRulesWelcome(interaction.guild, interaction.user);
        await interaction.editReply(`La previsualización se publicó en <#${welcomeChannelId}>.`);
      } else {
        payload.content = undefined;
        payload.allowedMentions = { users: [] };
        await interaction.editReply({ ...payload, content: 'Previsualización de bienvenida:' });
        await sendRulesWelcome(interaction.guild, interaction.user);
      }
    } catch (error) {
      console.error('No se pudo generar la previsualización de bienvenida:', error);
      const reason = error?.message?.slice(0, 700) || 'Error desconocido';
      await interaction.editReply(`No se pudo generar la bienvenida: ${reason}`);
    }
  },
};
