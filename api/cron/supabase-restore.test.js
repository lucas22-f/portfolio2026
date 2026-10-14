const assert = require('node:assert/strict');
const { test } = require('node:test');

const supabaseRestore = require('./supabase-restore');
const { createHandler } = supabaseRestore;

const env = {
  CRON_SECRET: 'test-cron-secret',
  SUPABASE_ACCESS_TOKEN: 'test-supabase-token',
  SUPABASE_PROJECT_REF: 'projectref123',
};

function makeRequest(options = {}) {
  const method = options.method || 'GET';
  const authorization = Object.hasOwn(options, 'authorization')
    ? options.authorization
    : `Bearer ${env.CRON_SECRET}`;
  return {
    method,
    headers: authorization === undefined ? {} : { authorization },
  };
}

function makeResponse() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function providerResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('requires an exact bearer secret and fails closed when configuration is missing', async () => {
  let fetchCalls = 0;
  const handler = createHandler({
    env,
    fetchImpl: async () => {
      fetchCalls += 1;
      return providerResponse(200, { status: 'ACTIVE_HEALTHY' });
    },
  });

  for (const authorization of [undefined, 'Bearer wrong-secret', 'bearer test-cron-secret']) {
    const response = makeResponse();
    await handler(makeRequest({ authorization }), response);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { error: 'unauthorized' });
  }

  const unsupportedMethodResponse = makeResponse();
  await handler(makeRequest({ method: 'POST' }), unsupportedMethodResponse);
  assert.equal(unsupportedMethodResponse.statusCode, 405);
  assert.equal(unsupportedMethodResponse.headers.allow, 'GET');

  const missingSecretResponse = makeResponse();
  await createHandler({
    env: { ...env, CRON_SECRET: '' },
    fetchImpl: async () => {
      fetchCalls += 1;
    },
  })(makeRequest(), missingSecretResponse);

  assert.equal(missingSecretResponse.statusCode, 503);

  const missingAccessTokenResponse = makeResponse();
  const missingAccessTokenHandler = createHandler({
    env: { ...env, SUPABASE_ACCESS_TOKEN: '' },
    fetchImpl: async () => {
      fetchCalls += 1;
    },
  });
  await missingAccessTokenHandler(makeRequest(), missingAccessTokenResponse);

  assert.equal(missingAccessTokenResponse.statusCode, 503);
  assert.equal(fetchCalls, 0);
});

test('does not restore a project unless its status is exactly INACTIVE', async () => {
  const calls = [];
  const handler = createHandler({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return providerResponse(200, { status: 'ACTIVE_HEALTHY' });
    },
  });
  const response = makeResponse();

  await handler(makeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, action: 'none', status: 'ACTIVE_HEALTHY' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.SUPABASE_ACCESS_TOKEN}`);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.redirect, 'error');
});

test('requests restore for INACTIVE projects using the fixed Supabase Management API', async () => {
  const calls = [];
  const handler = createHandler({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return options.method === 'GET'
        ? providerResponse(200, { status: 'INACTIVE' })
        : providerResponse(202, {});
    },
  });
  const response = makeResponse();

  await handler(makeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    action: 'restore_requested',
    status: 'INACTIVE',
  });
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['https://api.supabase.com/v1/projects/projectref123', 'GET'],
    ['https://api.supabase.com/v1/projects/projectref123/restore', 'POST'],
  ]);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, `Bearer ${env.SUPABASE_ACCESS_TOKEN}`);
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.redirect, 'error');
  }
});

test('returns a sanitized error when the Management API fails', async () => {
  let responseBodyRead = false;
  const handler = createHandler({
    env,
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => {
        responseBodyRead = true;
        return { error: 'provider body must not be exposed' };
      },
    }),
  });
  const response = makeResponse();

  await handler(makeRequest(), response);

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, { error: 'supabase_unavailable' });
  assert.equal(JSON.stringify(response.body).includes('provider body'), false);
  assert.equal(responseBodyRead, false);
});
