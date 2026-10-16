import { SlashCommandBuilder, EmbedBuilder, inlineCode } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Muestra la latencia de la API de Discord.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🏓 Pong')
      .setDescription(`Latencia de la API: ${inlineCode(`${Math.round(interaction.client.ws.ping)} ms`)}`)
      .setFooter({ text: 'DevVerse Studios' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
