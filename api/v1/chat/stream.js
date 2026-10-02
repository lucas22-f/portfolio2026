const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UPSTREAM_PATH = '/api/v1/chat/stream';
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'x-accel-buffering'];

module.exports = async function chatStreamProxy(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  const apiBaseUrl = process.env.API_BASE_URL;
  const serviceToken = process.env.CHAT_SERVICE_TOKEN;
  if (!apiBaseUrl || !serviceToken) {
    response.status(503).json({ error: 'chat-unavailable' });
    return;
  }

  let upstreamUrl;
  try {
    const base = new URL(apiBaseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
      throw new TypeError('invalid API base URL');
    }
    upstreamUrl = new URL(UPSTREAM_PATH, base);
  } catch {
    response.status(503).json({ error: 'chat-unavailable' });
    return;
  }

  const payload = request.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    response.status(400).json({ error: 'invalid-request' });
    return;
  }

  const abortController = new AbortController();
  const abortUpstream = () => abortController.abort();
  request.once('aborted', abortUpstream);
  response.once('close', () => {
    if (!response.writableEnded) abortUpstream();
  });

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceToken}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
      redirect: 'error',
    });
  } catch {
    if (!response.destroyed && !abortController.signal.aborted) {
      response.status(502).json({ error: 'chat-upstream-unavailable' });
    }
    return;
  }

  response.status(upstream.status);
  for (const header of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value !== null) response.setHeader(header, value);
  }

  if (!upstream.body) {
    response.end();
    return;
  }

  try {
    await pipeline(Readable.fromWeb(upstream.body), response);
  } catch {
    if (!response.destroyed) response.destroy();
  }
};
