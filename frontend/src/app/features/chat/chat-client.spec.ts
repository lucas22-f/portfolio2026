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
