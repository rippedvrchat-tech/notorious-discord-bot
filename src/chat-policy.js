export function isRelayablePublicChat(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('!')) return false;
  if (normalized.startsWith('@')) return false;
  if (/^\/asay(?:\s|$)/.test(normalized)) return false;
  return true;
}

export function formatPublicChatMessage(player, message) {
  return '**' + player + '**: ' + message;
}
