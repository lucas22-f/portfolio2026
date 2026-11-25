// Disable Vercel's JSON/body parser: WAV must remain raw, bounded bytes.
module.exports = async function transcribeProxy(request, response) {
  const fail = (status, error = 'transcription-unavailable') => response.status(status).json({ error });
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return fail(405, 'method-not-allowed');
  }
  let url;
  const token = process.env.CHAT_SERVICE_TOKEN;
  try {
    if (!token || !process.env.API_BASE_URL) throw new Error();
    const base = new URL(process.env.API_BASE_URL);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error();
    url = new URL('/api/v1/chat/transcribe', base);
  } catch {
    return fail(503);
  }
  if (request.headers['content-type']?.toLowerCase() !== 'audio/wav') return fail(415, 'invalid-audio');
  if (Number(request.headers['content-length']) > 3_000_000) return fail(413, 'invalid-audio');

  const controller = new AbortController();
  let readingUpload = true;
  const interruptUpload = () => { if (readingUpload) request.destroy(); };
  controller.signal.addEventListener('abort', interruptUpload);
  const abort = () => controller.abort();
  const close = () => { if (!response.writableEnded) abort(); };
  request.once('aborted', abort);
  response.once('close', close);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 25_000);
  let reader;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 3_000_000) return fail(413, 'invalid-audio');
      chunks.push(bytes);
    }
    readingUpload = false;
    if (!size) return fail(400, 'invalid-audio');
    if (controller.signal.aborted) return;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav', accept: 'application/json' },
      body: Buffer.concat(chunks),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return fail([400, 413, 415, 429, 503].includes(upstream.status) ? upstream.status : 502);
    }
    if (!upstream.body) return fail(502);
    reader = upstream.body.getReader();
    const parts = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65_536) return fail(502);
      parts.push(Buffer.from(value));
    }
    const payload = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 16_000) return fail(502);
    if (!controller.signal.aborted) {
      response.setHeader('Cache-Control', 'no-store');
      return response.status(200).json({ text: payload.text });
    }
  } catch {
    if (!response.destroyed && !controller.signal.aborted) return fail(502);
    if (timedOut && !response.destroyed && !response.writableEnded) return fail(504);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', interruptUpload);
    request.removeListener('aborted', abort);
    response.removeListener('close', close);
    if (reader) await reader.cancel().catch(() => {});
  }
};
module.exports.config = { api: { bodyParser: false } };
