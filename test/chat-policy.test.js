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
    '/kick player',
    '/help',
    '/asay',
    '/asay hidden',
    '/ASAY\tprivate'
  ]) {
    assert.equal(isRelayablePublicChat(message), false, message);
  }
});

test('formats public chat without enabling Discord mentions', () => {
  assert.equal(formatPublicChatMessage('Player', 'hello'), '**Player**: hello');
});
