import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPublicChatMessage, isRelayablePublicChat } from '../src/chat-policy.js';

test('allows ordinary public chat', () => {
  for (const message of ['hello', 'hello everyone', '  normal message  ']) {
    assert.equal(isRelayablePublicChat(message), true, message);
  }
});

test('blocks commands and private staff chat', () => {
  for (const message of [
    '',
    '   ',
    '!menu',
    ' !kick player',
    '@secret',
    ' @ staff only',
    '/help me with the map',
    '/some-admin-command',
    '/asay',
    '/asay hidden',
    '/ASAY\tprivate'
    , '\u200b!hidden-command'
    , '！admin command'
  ]) {
    assert.equal(isRelayablePublicChat(message), false, message);
  }
});

test('blocks metadata that marks a message as private or staff-only', () => {
  for (const metadata of [
    { team: true },
    { teamChat: true },
    { private: true },
    { admin: true },
    { staff: true },
    { isAdmin: true },
    { userGroup: 'moderator' },
    { userGroup: 'superadmin' },
    { channel: 'admin_chat' }
  ]) {
    assert.equal(isRelayablePublicChat('looks normal', metadata), false, JSON.stringify(metadata));
  }
});

test('formats public chat without enabling Discord mentions or markdown injection', () => {
  assert.equal(formatPublicChatMessage('@Player', 'hello @everyone *all*'), '**@\u200bPlayer**: hello @\u200beveryone \\*all\\*');
});
