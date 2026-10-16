import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  completeRobloxVerification,
  getVerificationSettings,
  startRobloxVerification,
} from './robloxVerification.js';

function verificationModal() {
  return new ModalBuilder()
    .setCustomId('roblox_verify_username_form')
    .setTitle('Vincular cuenta de Roblox')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('roblox_username')
        .setLabel('Nombre de usuario de Roblox')
        .setPlaceholder('Escribe tu username, no tu contraseña')
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(20)
        .setRequired(true),
    ));
}

export async function handleRobloxVerificationInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'roblox_verify_start') {
    const settings = await getVerificationSettings();
    if (settings.guildId !== interaction.guildId) {
      await interaction.reply({ content: 'La verificación todavía no está configurada en este servidor.', ephemeral: true });
      return true;
    }
    await interaction.showModal(verificationModal());
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'roblox_verify_username_form') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const username = interaction.fields.getTextInputValue('roblox_username');
      const verification = await startRobloxVerification(interaction.user.id, username);
      const profileUrl = `https://www.roblox.com/users/${verification.robloxUserId}/profile`;
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🧩 Confirma que es tu cuenta')
        .setDescription([
          `Encontré el perfil **${verification.username}**${verification.displayName && verification.displayName !== verification.username ? ` (${verification.displayName})` : ''}.`,
          '',
          'Añade este código temporal a la **descripción pública** de tu perfil de Roblox:',
          `\`${verification.challenge}\``,
          '',
          'Después, pulsa el botón de abajo. No compartas tu contraseña ni códigos de inicio de sesión.',
        ].join('\n'))
        .setURL(profileUrl)
        .setFooter({ text: 'El código vence en 15 minutos.' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('roblox_verify_confirm')
          .setLabel('✅ Ya puse el código')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setLabel('Abrir perfil de Roblox')
          .setStyle(ButtonStyle.Link)
          .setURL(profileUrl),
      );
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      await interaction.editReply(error.message || 'No pude iniciar la verificación. Inténtalo de nuevo.');
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'roblox_verify_confirm') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await completeRobloxVerification(interaction.guild, interaction.user.id);
      await interaction.editReply(`✅ **${result.username}** quedó vinculada a tu cuenta. Ya te asigné tus roles de DevVerse Studios.`);
    } catch (error) {
      await interaction.editReply(error.message || 'No pude completar la verificación. Inténtalo de nuevo.');
    }
    return true;
  }

  return false;
}

