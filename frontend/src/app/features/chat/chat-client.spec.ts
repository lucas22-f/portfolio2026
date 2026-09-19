import { describe, expect, it, vi } from 'vitest';

import {
  applyChatEvent,
  ChatClient,
  createChatState,
  parseSseEvents,
  type ChatEvent,
  logChatLifecycle,
} from './chat-client';

const CONTENT_VERSION = '838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c';

function sse(events: Array<Record<string, unknown>>): string {
  return events
    .map((event) => `event: ${event['type']}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

function response(body: BodyInit): Response {
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const start = {
  request_id: 'r-1',
  sequence: 1,
  type: 'start',
  protocol_version: '5',
  content_version: CONTENT_VERSION,
} as const;
const done = {
  request_id: 'r-1',
  sequence: 4,
  type: 'done',
  protocol_version: '5',
  content_version: CONTENT_VERSION,
  model: 'fake',
  usage: { total_tokens: 4 },
} as const;

describe('SSE event parsing', () => {
  it('accepts ordered allow-listed SSE frames', () => {
    const events = parseSseEvents(
      sse([
        start,
        { request_id: 'r-1', sequence: 2, type: 'tool', tool: 'search_portfolio' },
        {
          request_id: 'r-1',
          sequence: 3,
          type: 'part',
          part: { type: 'text', grounding: 'portfolio', text: 'Respuesta respaldada.' },
        },
        done,
      ]),
    );

    expect(events.map((event) => event.type)).toEqual(['start', 'tool', 'part', 'done']);
  });

  it('rejects malformed frames and event/data type mismatches', () => {
    expect(() => parseSseEvents('data: {}\n\n')).toThrow('invalid-provider-output');
    expect(() => parseSseEvents(`event: done\ndata: ${JSON.stringify(start)}\n\n`)).toThrow(
      'invalid-provider-output',
    );
  });
});

describe('ChatClient SSE streaming', () => {
  it('processes an SSE frame fragmented across chunks in sequence order', async () => {
    const body = sse([
      start,
      { request_id: 'r-1', sequence: 2, type: 'tool', tool: 'search_portfolio' },
      {
        request_id: 'r-1',
        sequence: 3,
        type: 'part',
        part: { type: 'text', grounding: 'portfolio', text: 'Hola' },
      },
      done,
    ]);
    const encoder = new TextEncoder();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(body.slice(0, 31)));
            controller.enqueue(encoder.encode(body.slice(31, 115)));
            controller.enqueue(encoder.encode(body.slice(115)));
            controller.close();
          },
        }),
      );
    const events: ChatEvent[] = [];

    await new ChatClient().stream('Consulta', (event) => events.push(event));
    globalThis.fetch = originalFetch;

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events[2]).toMatchObject({ type: 'part', part: { text: 'Hola' } });
  });

  it('accepts a portfolio tool call after a preview delta', async () => {
    const body = sse([
      start,
      { request_id: 'r-1', sequence: 2, type: 'text-delta', text: 'Preview' },
      { request_id: 'r-1', sequence: 3, type: 'tool', tool: 'search_portfolio' },
      {
        request_id: 'r-1',
        sequence: 4,
        type: 'part',
        part: { type: 'text', grounding: 'portfolio', text: 'Grounded answer.' },
      },
      {
        request_id: 'r-1',
        sequence: 5,
        type: 'part',
        part: { type: 'source', filename: 'portfolio.pdf', page: 2 },
      },
      { ...done, sequence: 6 },
    ]);
    expect(parseSseEvents(body).map((event) => event.type)).toEqual([
      'start',
      'text-delta',
      'tool',
      'part',
      'part',
      'done',
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(body);
    try {
      const events: ChatEvent[] = [];
      await new ChatClient().stream('Portfolio question', (event) => events.push(event));

      let state = createChatState();
      for (const event of events) state = applyChatEvent(state, event);
      expect(state.status).toBe('complete');
      expect(state.portfolioSearchUsed).toBe(true);
      expect(state.streamedText).toBe('');
      expect(state.parts).toEqual([
        { type: 'text', grounding: 'portfolio', text: 'Grounded answer.' },
        { type: 'source', filename: 'portfolio.pdf', page: 2 },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('passes a backend error after deltas through with its message', async () => {
    const backendMessage = 'El proveedor falló, intentá más tarde.';
    const body = sse([
      start,
      { request_id: 'r-1', sequence: 2, type: 'text-delta', text: 'Hola' },
      {
        request_id: 'r-1',
        sequence: 3,
        type: 'error',
        code: 'provider-unavailable',
        message: backendMessage,
        retryable: true,
      },
      { ...done, sequence: 4 },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(body);
    try {
      const events: ChatEvent[] = [];
      await new ChatClient().stream('Consulta', (event) => events.push(event));

      expect(events.map((event) => event.type)).toEqual(['start', 'text-delta', 'error', 'done']);
      let state = createChatState();
      for (const event of events) state = applyChatEvent(state, event);
      expect(state.status).toBe('error');
      expect(state.announcement).toBe(backendMessage);
      expect(state.retryable).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects a second start frame after emitting the first', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(sse([{ ...start }, { ...start, sequence: 2 }]));
    const events: ChatEvent[] = [];

    await expect(
      new ChatClient().stream('Consulta', (event) => events.push(event)),
    ).rejects.toMatchObject({
      code: 'invalid-provider-output',
      retryable: false,
    });
    expect(events.map((event) => event.type)).toEqual(['start']);
    globalThis.fetch = originalFetch;
  });

  it('rejects a terminally incomplete SSE stream as retryable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(sse([start]));

    await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
      code: 'stream-closed',
      retryable: true,
    });
    globalThis.fetch = originalFetch;
  });

  it('rejects incompatible content versions before rendering them', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      response(sse([{ ...start, content_version: 'different-version' }]));

    await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
      code: 'content-incompatible',
      retryable: false,
    });
    globalThis.fetch = originalFetch;
  });

  it('requires the SSE response media type', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(sse([start, done]));

    await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toThrow(
      'provider-unavailable',
    );
    globalThis.fetch = originalFetch;
  });
});

describe('chat state', () => {
  it('retains validated model and usage from done events', () => {
    const complete = applyChatEvent(applyChatEvent(createChatState(), start), done);
    expect(complete).toMatchObject({
      status: 'complete',
      model: 'fake',
      usage: { total_tokens: 4 },
    });
  });
});

describe('incremental text state', () => {
  it('replaces an incomplete preview with the complete validated answer exactly once', () => {
    const streaming = applyChatEvent(applyChatEvent(createChatState(), start), {
      request_id: 'r-1',
      sequence: 2,
      type: 'text-delta',
      text: 'Hola, esta respuesta',
    });
    const validated = applyChatEvent(streaming, {
      request_id: 'r-1',
      sequence: 3,
      type: 'part',
      part: { type: 'text', grounding: 'general', text: 'Hola, esta respuesta está validada.' },
    });
    expect(streaming.streamedText).toBe('Hola, esta respuesta');
    expect(validated.streamedText).toBe('');
    expect(validated.parts).toEqual([
      { type: 'text', grounding: 'general', text: 'Hola, esta respuesta está validada.' },
    ]);
  });
});

describe('direct incremental SSE ordering', () => {
  it('accepts direct text deltas before a validated general part', () => {
    const events = parseSseEvents(
      sse([
        start,
        { request_id: 'r-1', sequence: 2, type: 'text-delta', text: 'Hola' },
        {
          request_id: 'r-1',
          sequence: 3,
          type: 'part',
          part: { type: 'text', grounding: 'general', text: 'Hola' },
        },
        { ...done, sequence: 4 },
      ]),
    );
    expect(events.map((event) => event.type)).toEqual(['start', 'text-delta', 'part', 'done']);
  });
});

describe('preview delta tolerance', () => {
  it('skips ordered whitespace-only deltas without emitting them', async () => {
    const body = sse([
      start,
      { request_id: 'r-1', sequence: 2, type: 'text-delta', text: 'Hola' },
      { request_id: 'r-1', sequence: 3, type: 'text-delta', text: '   ' },
      { request_id: 'r-1', sequence: 4, type: 'text-delta', text: '\n' },
      { request_id: 'r-1', sequence: 5, type: 'text-delta', text: 'mundo' },
      {
        request_id: 'r-1',
        sequence: 6,
        type: 'part',
        part: { type: 'text', grounding: 'general', text: 'Hola mundo' },
      },
      { ...done, sequence: 7 },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(body);
    try {
      const events: ChatEvent[] = [];
      await new ChatClient().stream('Consulta', (event) => events.push(event));

      // Whitespace previews consume their exact sequence but never reach the UI.
      expect(events.map((event) => event.sequence)).toEqual([1, 2, 5, 6, 7]);
      let state = createChatState();
      for (const event of events) state = applyChatEvent(state, event);
      expect(state.status).toBe('complete');
      expect(state.parts).toEqual([{ type: 'text', grounding: 'general', text: 'Hola mundo' }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects a sequence gap before suppressing a whitespace-only delta', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      response(
        sse([
          start,
          { request_id: 'r-1', sequence: 3, type: 'text-delta', text: '   ' },
          { ...done, sequence: 4 },
        ]),
      );
    try {
      await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
        code: 'invalid-provider-output',
        detail: 'emit-precondition',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects preview deltas after portfolio grounding', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      response(
        sse([
          start,
          { request_id: 'r-1', sequence: 2, type: 'tool', tool: 'search_portfolio' },
          {
            request_id: 'r-1',
            sequence: 3,
            type: 'part',
            part: { type: 'text', grounding: 'portfolio', text: 'Grounded answer.' },
          },
          { request_id: 'r-1', sequence: 4, type: 'text-delta', text: 'stale' },
          { ...done, sequence: 5 },
        ]),
      );
    try {
      await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
        code: 'invalid-provider-output',
        detail: 'delta-after-grounding',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects whitespace-only deltas after a terminal outcome', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      response(
        sse([
          start,
          {
            request_id: 'r-1',
            sequence: 2,
            type: 'error',
            code: 'provider-unavailable',
            message: 'Provider failed.',
            retryable: true,
          },
          { request_id: 'r-1', sequence: 3, type: 'text-delta', text: '   ' },
          { ...done, sequence: 4 },
        ]),
      );
    try {
      await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
        code: 'invalid-provider-output',
        detail: 'terminal-rules',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('accepts HTML-containing preview deltas as inert text', async () => {
    const body = sse([
      start,
      { request_id: 'r-1', sequence: 2, type: 'text-delta', text: 'a <b>tag</b> preview' },
      {
        request_id: 'r-1',
        sequence: 3,
        type: 'part',
        part: { type: 'text', grounding: 'general', text: 'Respuesta final.' },
      },
      { ...done, sequence: 4 },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(body);
    try {
      const events: ChatEvent[] = [];
      await new ChatClient().stream('Consulta', (event) => events.push(event));

      expect(events.map((event) => event.type)).toEqual(['start', 'text-delta', 'part', 'done']);
      // The preview renders via interpolation, so the markup stays inert text.
      const delta = events[1];
      expect(delta.type === 'text-delta' && delta.text).toBe('a <b>tag</b> preview');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps strict validation for final parts with HTML', async () => {
    const body = sse([
      start,
      {
        request_id: 'r-1',
        sequence: 2,
        type: 'part',
        part: { type: 'text', grounding: 'general', text: 'a <b>tag</b> part' },
      },
      { ...done, sequence: 3 },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(body);
    try {
      await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
        code: 'invalid-provider-output',
        detail: 'text-validation',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('names the tripped check on invalid errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(sse([{ ...start }, { ...start, sequence: 2 }]));
    try {
      await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
        code: 'invalid-provider-output',
        detail: 'emit-precondition',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('names delta validation failures without throwing for skippable previews', () => {
    expect(() =>
      parseSseEvents(
        sse([
          start,
          { request_id: 'r-1', sequence: 2, type: 'text-delta', text: 42 },
          { ...done, sequence: 3 },
        ]),
      ),
    ).toThrow('invalid-provider-output');
    try {
      parseSseEvents(
        sse([
          start,
          { request_id: 'r-1', sequence: 2, type: 'text-delta', text: 42 },
          { ...done, sequence: 3 },
        ]),
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid-provider-output',
        detail: 'delta-text-validation',
      });
      return;
    }
    throw new Error('expected delta-text-validation to throw');
  });
});
describe('chat observability', () => {
  it('records only metadata during an SSE stream', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const originalFetch = globalThis.fetch;
    const privatePrompt = 'private user prompt';
    const privateText = 'private streamed answer';
    globalThis.fetch = async () =>
      response(
        sse([
          start,
          { request_id: 'r-1', sequence: 2, type: 'text-delta', text: privateText },
          {
            request_id: 'r-1',
            sequence: 3,
            type: 'part',
            part: { type: 'text', grounding: 'general', text: privateText },
          },
          done,
        ]),
      );

    await new ChatClient().stream(privatePrompt, () => undefined);

    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).toContain('chat.event_received');
    expect(serialized).not.toContain(privatePrompt);
    expect(serialized).not.toContain(privateText);
    globalThis.fetch = originalFetch;
    info.mockRestore();
  });
});

describe('contact form protocol', () => {
  const formPart = {
    type: 'interview_contact_form',
    form_version: '1',
    submission_version: '1',
    intent: 'interview',
    fields: ['name', 'email', 'company', 'message'],
  };

  it('accepts only the exact fixed form part', () => {
    const events = parseSseEvents(
      sse([
        start,
        { request_id: 'r-1', sequence: 2, type: 'part', part: formPart },
        { ...done, sequence: 3 },
      ]),
    );
    expect(events[1]).toMatchObject({ type: 'part', part: formPart });
    for (const unsafe of [
      { ...formPart, form_version: '2' },
      { ...formPart, html: '<form></form>' },
      { ...formPart, fields: ['email', 'name', 'company', 'message'] },
    ]) {
      expect(() =>
        parseSseEvents(
          sse([
            start,
            { request_id: 'r-1', sequence: 2, type: 'part', part: unsafe },
            { ...done, sequence: 3 },
          ]),
        ),
      ).toThrow('invalid-provider-output');
    }
  });

  it('advertises negotiated capabilities and submits only declared values', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (!init)
        return new Response(
          JSON.stringify({
            content_version: CONTENT_VERSION,
            protocol_version: '5',
            capabilities: { interview_contact_form: '1', contact_submission: '1' },
          }),
          { status: 200 },
        );
      if (String(url).endsWith('/chat/stream'))
        return response(sse([start, { ...done, sequence: 2 }]));
      return new Response(
        JSON.stringify({ outcome: 'accepted', retryable: false, request_id: 'safe-id' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    try {
      const client = new ChatClient();
      expect(await client.checkCompatibility()).toBe(true);
      await client.stream('Interview', () => undefined);
      await client.submitContact(
        { name: 'Ada', email: 'ada@example.com', company: '', message: 'Interview' },
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(JSON.parse(String(requests[1].init?.body))).toMatchObject({
        capabilities: { interview_contact_form: '1', contact_submission: '1' },
      });
      expect(JSON.parse(String(requests[2].init?.body))).toEqual({
        submission_version: '1',
        name: 'Ada',
        email: 'ada@example.com',
        company: null,
        message: 'Interview',
      });
      expect((requests[2].init?.headers as Record<string, string>)['idempotency-key']).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps contact values out of lifecycle telemetry', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ outcome: 'delivery_retryable', retryable: true, request_id: 'safe-id' }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    try {
      await new ChatClient().submitContact(
        {
          name: 'Private Name',
          email: 'private@example.com',
          company: 'Private Company',
          message: 'Private message',
        },
        '550e8400-e29b-41d4-a716-446655440000',
      );
      const logs = JSON.stringify(info.mock.calls);
      expect(logs).toContain('delivery_retryable');
      expect(logs).not.toContain('Private');
      expect(logs).not.toContain('private@example.com');
    } finally {
      globalThis.fetch = originalFetch;
      info.mockRestore();
    }
  });
});
