import {
  AttachmentBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

function permissionLine(allow, deny) {
  const granted = allow.toArray();
  const blocked = deny.toArray();
  return `Permite: ${granted.length ? granted.join(', ') : 'ninguno'} | Deniega: ${blocked.length ? blocked.join(', ') : 'ninguno'}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('exportar-servidor')
    .setDescription('Te envía en privado un TXT con canales, roles y permisos.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Solo un administrador puede exportar esta configuración.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const guild = interaction.guild;
      await guild.channels.fetch();
      await guild.roles.fetch();
      const lines = [
        `INFORME DE CONFIGURACIÓN • ${guild.name}`,
        `ID del servidor: ${guild.id}`,
        `Generado: ${new Date().toISOString()}`,
        '',
        '=== ROLES ===',
      ];

      const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
      for (const role of roles) {
        const permissions = role.permissions.toArray();
        lines.push(
          `• ${role.name} | ID: ${role.id} | Posición: ${role.position} | Color: ${role.hexColor} | Mencionable: ${role.mentionable} | Administrado por integración: ${role.managed}`,
          `  Permisos: ${permissions.length ? permissions.join(', ') : 'ninguno'}`,
        );
      }

      lines.push('', '=== CANALES Y PERMISOS ESPECÍFICOS ===');
      const channels = [...guild.channels.cache.values()].sort((a, b) => {
        const parentCompare = (a.parent?.position ?? -1) - (b.parent?.position ?? -1);
        return parentCompare || a.position - b.position;
      });
      for (const channel of channels) {
        lines.push('', `# ${channel.name} | ID: ${channel.id} | Tipo: ${channel.constructor.name} | Categoría: ${channel.parent?.name ?? 'ninguna'}`);
        const overwrites = channel.permissionOverwrites?.cache;
        if (!overwrites?.size) {
          lines.push('  Sin permisos específicos por canal.');
          continue;
        }
        for (const overwrite of overwrites.values()) {
          const target = overwrite.id === guild.id
            ? '@everyone'
            : overwrite.type === 0
              ? guild.roles.cache.get(overwrite.id)?.name ?? `rol ${overwrite.id}`
              : guild.members.cache.get(overwrite.id)?.user.tag ?? `miembro ${overwrite.id}`;
          lines.push(`  • ${target} (${overwrite.type === 0 ? 'rol' : 'miembro'}): ${permissionLine(overwrite.allow, overwrite.deny)}`);
        }
      }

      const attachment = new AttachmentBuilder(Buffer.from(`${lines.join('\n')}\n`, 'utf8'), {
        name: `DevVerse-configuracion-${guild.id}.txt`,
      });
      await interaction.editReply({ content: 'Aquí tienes el informe. Este archivo solo es visible para ti.', files: [attachment] });
    } catch (error) {
      console.error('No se pudo exportar la configuración del servidor:', error);
      await interaction.editReply('No pude generar el TXT. Revisa que el bot pueda ver los canales y roles del servidor.');
    }
  },
};

