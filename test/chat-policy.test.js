import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPublicChatMessage, isRelayablePublicChat } from '../src/chat-policy.js';

test('allows ordinary public chat', () => {
  for (const message of ['hello', 'hello everyone', '  normal message  ', '/help me with the map']) {
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
    '/asay',
    '/asay hidden',
    '/ASAY\tprivate'
  ]) {
    assert.equal(isRelayablePublicChat(message), false, message);
  }
});

test('formats public chat', () => {
  assert.equal(formatPublicChatMessage('Player', 'hello'), '**Player**: hello');
});
