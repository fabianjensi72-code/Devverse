import config from '../config.json' with { type: 'json' };

const ids = config.roles?.moderationStaff ?? config.roles?.ticketNotifyRoles ?? [];
const timeoutIds = config.roles?.moderationTimeoutStaff ?? [];

export function isModerationStaff(interaction, action = 'manage') {
  if (interaction.memberPermissions?.has('Administrator')) return true;
  const requiredPermission = action === 'timeout' ? 'ModerateMembers' : 'ManageMessages';
  if (interaction.memberPermissions?.has(requiredPermission)) return true;
  const allowedRoles = action === 'timeout' ? timeoutIds : ids;
  const memberRoles = interaction.member?.roles;
  if (memberRoles?.cache) return Boolean(memberRoles.cache.some((role) => allowedRoles.includes(role.id)));
  return Boolean(memberRoles?.some?.((roleId) => allowedRoles.includes(roleId)));
}

export function moderationConfig() {
  return config;
}

