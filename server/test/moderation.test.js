import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMentions } from '../src/moderation.js';

test('mentions: plain usernames, lowercased and de-duplicated', () => {
  assert.deepEqual(extractMentions('hey @JimBob and @jimbob'), ['jimbob']);
});

test('mentions: YouTube handles with hyphens and dots match whole', () => {
  assert.deepEqual(extractMentions('@Bro-tl7qq TOS'), ['bro-tl7qq']);
  assert.deepEqual(extractMentions('ask @mr.smith_99 about it'), ['mr.smith_99']);
});

test('mentions: trailing punctuation is not part of the name', () => {
  assert.deepEqual(extractMentions('thanks @jimbob. and @sue-!'), ['jimbob', 'sue']);
});

test('mentions: emails and too-short names are ignored', () => {
  assert.deepEqual(extractMentions('mail me@site.com or @ab'), []);
});
