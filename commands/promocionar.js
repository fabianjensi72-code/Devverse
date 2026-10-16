import {
  ActionRowBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import config from '../config.json' with { type: 'json' };

const channels = config.channels ?? {};

export default {
  data: new SlashCommandBuilder()
    .setName('promocionar')
    .setDescription('Abre el formulario para publicar tu juego de Roblox.'),

  async execute(interaction) {
    if (!channels.promoteYourGame && !channels.mediaShare) {
      await interaction.reply({ content: 'El canal de promoción todavía no está configurado. Avísale al Staff.', ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('promocionar:formulario')
      .setTitle('Presenta tu juego de Roblox')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('titulo')
            .setLabel('Título del juego')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('enlace')
            .setLabel('Enlace de Roblox')
            .setPlaceholder('https://www.roblox.com/games/...')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(200)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('descripcion')
            .setLabel('Breve descripción')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      )
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Imagen del juego (opcional)')
          .setDescription('Sube una captura PNG, JPG, GIF o WEBP')
          .setFileUploadComponent(
            new FileUploadBuilder()
              .setCustomId('imagen')
              .setMinValues(0)
              .setMaxValues(1)
              .setRequired(false),
          ),
      );

    await interaction.showModal(modal);
  },
};
