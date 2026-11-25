const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { test } = require('node:test');

function request(body = Buffer.from('wav'), type = 'audio/wav') {
  const req = Readable.from([body]);
  req.method = 'POST';
  req.headers = { 'content-type': type };
  return req;
}
function response() {
  const chunks = [];
  const res = new Writable({ write(chunk, _, done) { chunks.push(chunk); done(); } });
  res.headers = {};
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (value) => { res.end(JSON.stringify(value)); return res; };
  res.text = () => Buffer.concat(chunks).toString();
  return res;
}

test('transcription proxy boundaries, fixed auth route, sanitized output and cancellation', async (t) => {
  const oldFetch = global.fetch;
  const oldBase = process.env.API_BASE_URL;
  const oldToken = process.env.CHAT_SERVICE_TOKEN;
  const proxy = require('./transcribe');
  process.env.API_BASE_URL = 'https://backend.example.test/prefix';
  process.env.CHAT_SERVICE_TOKEN = 'fake-test-token';
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://backend.example.test/api/v1/chat/transcribe');
    assert.equal(options.headers.authorization, 'Bearer fake-test-token');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['content-type'], 'audio/wav');
    return new Response(JSON.stringify({ text: 'Consulta editable', secret: 'never forward' }));
  };
  try {
    await t.test('preserves valid raw audio forwarding and returns only transcript', async () => {
      const res = response();
      await proxy(request(), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.text(), '{"text":"Consulta editable"}');
    });
    await t.test('rejects method, type and oversized input without upstream calls', async () => {
      const before = calls;
      for (const [req, expected] of [
        [Object.assign(request(), { method: 'GET' }), 405],
        [request(Buffer.from('wav'), 'application/json'), 415],
        [request(Buffer.alloc(3_000_001)), 413],
        [request(Buffer.alloc(0)), 400],
      ]) {
        const res = response();
        await proxy(req, res);
        assert.equal(res.statusCode, expected);
        assert.match(res.text(), /^\{"error":"[a-z-]+"\}$/);
      }
      assert.equal(calls, before);
    });
    await t.test('fails closed with missing token or unsafe URL', async () => {
      const before = calls;
      delete process.env.CHAT_SERVICE_TOKEN;
      let res = response();
      await proxy(request(), res);
      assert.equal(res.statusCode, 503);
      process.env.CHAT_SERVICE_TOKEN = 'fake-test-token';
      process.env.API_BASE_URL = 'https://user:password@example.test';
      res = response();
      await proxy(request(), res);
      assert.equal(res.statusCode, 503);
      assert.equal(calls, before);
      process.env.API_BASE_URL = 'https://backend.example.test';
    });
    await t.test('bounds upstream response and hides upstream error bodies', async () => {
      for (const upstream of [new Response('sensitive', { status: 500 }), new Response('x'.repeat(65_537))]) {
        global.fetch = async () => upstream;
        const res = response();
        await proxy(request(), res);
        assert.equal(res.statusCode, 502);
        assert.equal(res.text(), '{"error":"transcription-unavailable"}');
      }
    });
    await t.test('deadline also interrupts a stalled upload before fetch', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const req = new Readable({ read() {} });
      req.method = 'POST';
      req.headers = { 'content-type': 'audio/wav' };
      const res = response();
      const fetch = global.fetch;
      global.fetch = async () => { throw new Error('must not call upstream'); };
      const pending = proxy(req, res);
      try {
        t.mock.timers.tick(25_000);
        const finished = await Promise.race([pending.then(() => true), new Promise((done) => setImmediate(() => done(false)))]);
        assert.equal(finished, true);
        assert.equal(res.statusCode, 504);
        assert.equal(res.text(), '{"error":"transcription-unavailable"}');
      } finally {
        req.push(null);
        await pending;
        t.mock.timers.reset();
        global.fetch = fetch;
      }
    });
    await t.test('aborts upstream on client disconnect', async () => {
      let signal;
      let started;
      const ready = new Promise((resolve) => { started = resolve; });
      global.fetch = async (_, options) => {
        signal = options.signal;
        started();
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('private'))));
      };
      const req = request();
      const res = response();
      const pending = proxy(req, res);
      await ready;
      req.emit('aborted');
      await pending;
      assert.equal(signal.aborted, true);
      assert.equal(res.text(), '');
    });
  } finally {
    global.fetch = oldFetch;
    if (oldBase === undefined) delete process.env.API_BASE_URL; else process.env.API_BASE_URL = oldBase;
    if (oldToken === undefined) delete process.env.CHAT_SERVICE_TOKEN; else process.env.CHAT_SERVICE_TOKEN = oldToken;
  }
});
