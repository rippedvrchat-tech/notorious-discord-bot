export function isRelayablePublicChat(value, metadata = {}) {
  if (metadata && typeof metadata === 'object') {
    if (
      metadata.team || metadata.teamChat || metadata.isTeam || metadata.isTeamChat ||
      metadata.private || metadata.privateChat || metadata.isPrivate ||
      metadata.admin || metadata.adminChat || metadata.isAdmin ||
      metadata.staff || metadata.staffChat || metadata.isStaff ||
      metadata.moderator || metadata.isModerator ||
      /^(?:super)?admin|moderator|mod|staff|owner|operator|trialmod|helper$/i.test(String(metadata.userGroup ?? '')) ||
      ['team', 'private', 'admin', 'staff', 'admin_chat', 'staff_chat'].includes(String(metadata.channel ?? '').toLowerCase())
    ) return false;
  }
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('!')) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.startsWith('@')) return false;
  return true;
}

function escapeDiscordText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]()#+.!|>~-])/g, '\\$1')
    .replace(/@/g, '@\u200b');
}

export function formatPublicChatMessage(player, message) {
  return '**' + escapeDiscordText(player) + '**: ' + escapeDiscordText(message);
}
