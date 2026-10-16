import { Events } from 'discord.js';
import { createWelcomeCard, createWelcomePayload, getWelcomeChannelId, sendRulesWelcome } from '../utils/welcomeMessage.js';
import { getVerificationSettings } from '../utils/robloxVerification.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const verification = await getVerificationSettings();
      if (verification.guildId === member.guild.id && verification.unverifiedRoleIds?.length) {
        const roles = verification.unverifiedRoleIds.filter((roleId) => member.guild.roles.cache.has(roleId));
        if (roles.length) {
          await member.roles.add(roles, 'Rol temporal para miembro pendiente de verificación de Roblox.');
        }
      }
    } catch (error) {
      console.error(`No se pudo asignar el rol pendiente de verificación a ${member.user.tag}:`, error);
    }

    const welcomeChannelId = getWelcomeChannelId();
    if (!welcomeChannelId) {
      console.error('Bienvenida omitida: configura channels.welcomeChannelId en config.json.');
      return;
    }

    try {
      const channel = await member.guild.channels.fetch(welcomeChannelId);
      if (!channel?.isTextBased() || !channel.send) {
        console.error(`El canal de bienvenida ${welcomeChannelId} no existe o no admite mensajes.`);
        return;
      }

      const attachment = await createWelcomeCard(member.user);
      await channel.send({
        ...createWelcomePayload(member.user, member.guild.id),
        files: [attachment],
      });

      await sendRulesWelcome(member.guild, member.user);
    } catch (error) {
      console.error(`No se pudo enviar la bienvenida para ${member.user.tag}:`, error);
    }
  },
};

