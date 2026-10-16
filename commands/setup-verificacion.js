import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getVerificationSettings, saveVerificationSettings } from '../utils/robloxVerification.js';
import config from '../config.json' with { type: 'json' };

export default {
  data: new SlashCommandBuilder()
    .setName('setup-verificacion')
    .setDescription('Crea el canal y panel para verificar cuentas de Roblox.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((option) => option
      .setName('rol-verificado')
      .setDescription('Rol que recibirá el miembro al verificar su Roblox.')
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('rol-adicional')
      .setDescription('Segundo rol opcional que también recibirá al verificar.')
      .setRequired(false))
    .addRoleOption((option) => option
      .setName('rol-sin-verificar')
      .setDescription('Rol opcional que se quitará después de verificar.')
      .setRequired(false)),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Solo un administrador puede configurar la verificación.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const botMember = guild.members.me ?? await guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply('Necesito el permiso **Gestionar roles** para asignar los roles al verificar.');
      return;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.editReply('Necesito el permiso **Gestionar canales** para crear el canal de verificación.');
      return;
    }

    const verifiedRoles = [
      interaction.options.getRole('rol-verificado', true),
      interaction.options.getRole('rol-adicional'),
    ].filter(Boolean);
    const unverifiedRole = interaction.options.getRole('rol-sin-verificar');
    const targetRoles = [...verifiedRoles, ...(unverifiedRole ? [unverifiedRole] : [])];
    const invalidRole = targetRoles.find((role) =>
      role.id === guild.id || role.managed || role.position >= botMember.roles.highest.position,
    );
    if (invalidRole) {
      await interaction.editReply(`No puedo gestionar el rol **${invalidRole.name}**. Coloca el rol del bot por encima de los roles de verificación y usa roles que no estén administrados por una integración.`);
      return;
    }

    const previousSettings = await getVerificationSettings();
    const configuredChannelId = previousSettings.guildId === guild.id && previousSettings.channelId
      ? previousSettings.channelId
      : config.channels?.verificationChannelId;
    let channel = configuredChannelId
      ? await guild.channels.fetch(configuredChannelId).catch(() => null)
      : null;
    if (!channel) {
      channel = await guild.channels.create({
        name: 'verificacion-roblox',
        type: ChannelType.GuildText,
        topic: 'Verifica tu cuenta de Roblox para obtener tus roles de DevVerse Studios.',
        permissionOverwrites: [
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages],
          },
          {
            id: botMember.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
          },
        ],
        reason: 'Canal para verificar cuentas de Roblox en DevVerse Studios.',
      });
    }
    if (channel.type !== ChannelType.GuildText) {
      await interaction.editReply('El canal de verificación guardado no es un canal de texto. Configura otro canal de verificación y vuelve a ejecutar el comando.');
      return;
    }

    await saveVerificationSettings({
      guildId: guild.id,
      channelId: channel.id,
      verifiedRoleIds: verifiedRoles.map((role) => role.id),
      unverifiedRoleIds: unverifiedRole ? [unverifiedRole.id] : [],
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: 'DEVVERSE STUDIOS • VERIFICACIÓN', iconURL: interaction.client.user.displayAvatarURL() })
      .setTitle('🔐 Verifica tu cuenta de Roblox')
      .setDescription([
        'Vincula tu cuenta para recibir tus roles de la comunidad.',
        '',
        '**Cómo funciona:**',
        '1. Pulsa **Verificar Roblox** y escribe tu nombre de usuario.',
        '2. Copia el código temporal que te dará el bot en la descripción pública de tu perfil de Roblox.',
        '3. Vuelve aquí y pulsa **Ya puse el código**.',
        '',
        'No compartas tu contraseña, cookies ni códigos de inicio de sesión. El código temporal solo demuestra que puedes editar la descripción de ese perfil.',
      ].join('\\n'))
      .setFooter({ text: 'El código vence en 15 minutos • DevVerse Studios' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('roblox_verify_start').setLabel('🎮 Verificar Roblox').setStyle(ButtonStyle.Primary),
    );
    await channel.send({ embeds: [embed], components: [row] });
    await interaction.editReply(`Panel de verificación publicado en <#${channel.id}>. Al verificar, se asignará ${verifiedRoles.map((role) => `<@&${role.id}>`).join(' y ')}${unverifiedRole ? ` y se quitará <@&${unverifiedRole.id}>` : ''}.`);
  },
};
