const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Writable } = require('node:stream');
const { test } = require('node:test');

const chatStreamProxy = require('./stream');

function makeRequest(body = { message: 'hello' }) {
  const request = new EventEmitter();
  request.method = 'POST';
  request.body = body;
  return request;
}

function makeResponse() {
  const chunks = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  response.headers = {};
  response.setHeader = (name, value) => {
    response.headers[name.toLowerCase()] = value;
  };
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(body));
    return response;
  };
  response.bodyText = () => Buffer.concat(chunks).toString('utf8');
  return response;
}

test('fails closed when runtime credentials are missing', async () => {
  const previousBaseUrl = process.env.API_BASE_URL;
  const previousToken = process.env.CHAT_SERVICE_TOKEN;
  delete process.env.API_BASE_URL;
  delete process.env.CHAT_SERVICE_TOKEN;
  const response = makeResponse();

  try {
    await chatStreamProxy(makeRequest(), response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.bodyText(), '{"error":"chat-unavailable"}');
  } finally {
    if (previousBaseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.CHAT_SERVICE_TOKEN;
    else process.env.CHAT_SERVICE_TOKEN = previousToken;
  }
});

test('forwards to the fixed backend route with server-side auth and streams safe headers', async () => {
  const previousBaseUrl = process.env.API_BASE_URL;
  const previousToken = process.env.CHAT_SERVICE_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.API_BASE_URL = 'https://backend.example.test/prefix';
  process.env.CHAT_SERVICE_TOKEN = 'test-token';
  const upstreamBody = 'event: start\ndata: {}\n\n';
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return new Response(upstreamBody, {
      status: 201,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
        'set-cookie': 'not-forwarded=yes',
      },
    });
  };
  const response = makeResponse();

  try {
    await chatStreamProxy(makeRequest(), response);
    assert.equal(requestUrl, 'https://backend.example.test/api/v1/chat/stream');
    assert.equal(requestOptions.headers.authorization, 'Bearer test-token');
    assert.equal(requestOptions.body, JSON.stringify({ message: 'hello' }));
    assert.equal(response.statusCode, 201);
    assert.equal(response.headers['content-type'], 'text/event-stream');
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.equal(response.headers['x-accel-buffering'], 'no');
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.bodyText(), upstreamBody);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.CHAT_SERVICE_TOKEN;
    else process.env.CHAT_SERVICE_TOKEN = previousToken;
  }
});

test('propagates a disconnected client to the upstream fetch signal', async () => {
  const previousBaseUrl = process.env.API_BASE_URL;
  const previousToken = process.env.CHAT_SERVICE_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.API_BASE_URL = 'http://127.0.0.1:8000';
  process.env.CHAT_SERVICE_TOKEN = 'test-token';
  let upstreamSignal;
  globalThis.fetch = (_url, options) => {
    upstreamSignal = options.signal;
    return new Promise((_resolve, reject) => {
      upstreamSignal.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });
  };
  const request = makeRequest();
  const response = makeResponse();

  try {
    const proxy = chatStreamProxy(request, response);
    request.emit('aborted');
    await proxy;
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(response.statusCode, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.CHAT_SERVICE_TOKEN;
    else process.env.CHAT_SERVICE_TOKEN = previousToken;
  }
});
