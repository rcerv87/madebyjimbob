import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'stream';
import pino from 'pino';
import { loggerOptions } from '../src/logger.js';

// A logger with the app's options that writes into an array instead of stdout.
function capture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(chunk));
      done();
    },
  });
  return { log: pino({ ...loggerOptions, level: 'info' }, stream), lines };
}

test('redacts auth headers, cookies, passwords, and tokens', () => {
  const { log, lines } = capture();
  log.info({
    req: { headers: { authorization: 'Bearer secret-token', cookie: 'sid=abc', host: 'x' } },
    body: { username: 'jimbob', password: 'hunter22', token: 'tok' },
  });
  const out = JSON.stringify(lines[0]);
  for (const secret of ['secret-token', 'sid=abc', 'hunter22', '"tok"'])
    assert.ok(!out.includes(secret), secret);
  assert.equal(lines[0].req.headers.host, 'x');
  assert.equal(lines[0].body.username, 'jimbob');
});

test('errors are logged with their stack', () => {
  const { log, lines } = capture();
  log.error({ err: new Error('boom') }, 'failed');
  assert.equal(lines[0].err.message, 'boom');
  assert.match(lines[0].err.stack, /Error: boom/);
});
