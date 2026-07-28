import { describe, expect, it } from 'vitest';

import {
  applyChatEvent,
  ChatClient,
  createChatState,
  parseNdjsonEvents,
  type ChatEvent,
} from './chat-client';

describe('parseNdjsonEvents', () => {
  it('accepts only ordered allow-listed parts', () => {
    const events = parseNdjsonEvents(
      [
        '{"request_id":"r-1","sequence":1,"type":"start","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c"}',
        '{"request_id":"r-1","sequence":2,"type":"part","part":{"type":"text","text":"Respuesta respaldada.","record_ids":["p1"],"claim_ids":["c1"]}}',
        '{"request_id":"r-1","sequence":3,"type":"part","part":{"type":"source","record_id":"p1","label":"Proyecto"}}',
        '{"request_id":"r-1","sequence":4,"type":"done","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c","model":"fake","usage":{"total_tokens":4},"model":"mock","usage":{"total_tokens":4}}',
      ].join('\n'),
    );

    expect(events.map((event) => event.type)).toEqual(['start', 'part', 'part', 'done']);
    expect(events[1]).toMatchObject({
      type: 'part',
      part: { type: 'text', text: 'Respuesta respaldada.' },
    });
  });

  it('rejects malformed, unsafe, and out-of-sequence events', () => {
    expect(() =>
      parseNdjsonEvents(
        '{"request_id":"r","sequence":1,"type":"part","part":{"type":"text","text":"<strong>no</strong>"}}',
      ),
    ).toThrow('invalid-provider-output');
    expect(() =>
      parseNdjsonEvents(
        '{"request_id":"r","sequence":2,"type":"start","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c"}',
      ),
    ).toThrow('invalid-provider-output');
  });
});

describe('applyChatEvent', () => {
  const start: ChatEvent = {
    request_id: 'r-1',
    sequence: 1,
    type: 'start',
    content_version: '838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c',
  };

  it('renders a refusal as a Spanish non-retryable response', () => {
    const state = applyChatEvent(applyChatEvent(createChatState(), start), {
      request_id: 'r-1',
      sequence: 2,
      type: 'refusal',
      code: 'unsupported-request',
      message: 'No cuento con información para responder eso.',
      retryable: false,
    });

    expect(state.status).toBe('refused');
    expect(state.announcement).toBe('No cuento con información para responder eso.');
    expect(state.retryable).toBe(false);
  });

  it('preserves allowed parts and offers retry only for recoverable errors', () => {
    const withPart = applyChatEvent(applyChatEvent(createChatState(), start), {
      request_id: 'r-1',
      sequence: 2,
      type: 'part',
      part: {
        type: 'project-card',
        record_id: 'p1',
        title: 'Proyecto',
        summary: 'Resumen',
        links: [{ label: 'Ver', url: 'https://example.test' }],
      },
    });
    const state = applyChatEvent(withPart, {
      request_id: 'r-1',
      sequence: 3,
      type: 'error',
      code: 'provider-unavailable',
      message: 'No pude completar la respuesta.',
      retryable: true,
    });

    expect(state.parts).toHaveLength(1);
    expect(state.status).toBe('error');
    expect(state.retryable).toBe(true);
  });
});

describe('ChatClient stream', () => {
  it.each([
    [
      'part',
      '{"request_id":"r-1","sequence":1,"type":"part","part":{"type":"text","text":"No debe mostrarse","record_ids":[],"claim_ids":[]}}',
    ],
    [
      'done',
      '{"request_id":"r-1","sequence":1,"type":"done","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c","model":"fake","usage":{"total_tokens":4}}',
    ],
    [
      'error',
      '{"request_id":"r-1","sequence":1,"type":"error","code":"provider-unavailable","message":"Error seguro.","retryable":true}',
    ],
    [
      'refusal',
      '{"request_id":"r-1","sequence":1,"type":"refusal","code":"unsupported-request","message":"No puedo responder.","retryable":false}',
    ],
  ])('rejects sequence-one %s before emitting it', async (_type, line) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(`${line}\n`, { status: 200 });
    const events: ChatEvent[] = [];

    const result = new ChatClient().stream('Consulta', (event) => events.push(event));

    await expect(result).rejects.toMatchObject({
      code: 'invalid-provider-output',
      retryable: false,
    });
    expect(events).toEqual([]);
    globalThis.fetch = originalFetch;
  });

  it('rejects a second start event before emitting it', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        [
          '{"request_id":"r-1","sequence":1,"type":"start","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c"}',
          '{"request_id":"r-1","sequence":2,"type":"start","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c"}',
        ].join('\n'),
        { status: 200 },
      );
    const events: ChatEvent[] = [];

    const result = new ChatClient().stream('Consulta', (event) => events.push(event));

    await expect(result).rejects.toMatchObject({
      code: 'invalid-provider-output',
      retryable: false,
    });
    expect(events.map((event) => event.type)).toEqual(['start']);
    globalThis.fetch = originalFetch;
  });

  it('processes NDJSON split across chunks in sequence order', async () => {
    const encoder = new TextEncoder();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                '{"request_id":"r-1","sequence":1,"type":"start","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c"}\n{"request_id":"r-1","sequence":2,"type":"part","part":{"type":"text","text":"Hola","record_ids":[],"claim_ids":[]}}',
              ),
            );
            controller.enqueue(
              encoder.encode(
                '\n{"request_id":"r-1","sequence":3,"type":"done","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c","model":"fake","usage":{"total_tokens":4}}\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      );
    const events: ChatEvent[] = [];

    await new ChatClient().stream('Consulta', (event) => events.push(event));
    globalThis.fetch = originalFetch;

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events[1]).toMatchObject({ type: 'part', part: { text: 'Hola' } });
  });

  it('rejects a stream that closes without a terminal event as retryable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        '{"request_id":"r-1","sequence":1,"type":"start","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c"}\n',
        {
          status: 200,
        },
      );

    const result = new ChatClient().stream('Consulta', () => undefined);

    await expect(result).rejects.toMatchObject({ code: 'stream-closed', retryable: true });
    globalThis.fetch = originalFetch;
  });

  it('rejects events after a terminal event before rendering them', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        [
          '{"request_id":"r-1","sequence":1,"type":"start","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c"}',
          '{"request_id":"r-1","sequence":2,"type":"done","content_version":"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c","model":"fake","usage":{"total_tokens":4}}',
          '{"request_id":"r-1","sequence":3,"type":"part","part":{"type":"text","text":"No debe mostrarse","record_ids":[],"claim_ids":[]}}',
        ].join('\n'),
        { status: 200 },
      );
    const events: ChatEvent[] = [];

    const result = new ChatClient().stream('Consulta', (event) => events.push(event));

    await expect(result).rejects.toMatchObject({
      code: 'invalid-provider-output',
      retryable: false,
    });
    expect(events.map((event) => event.type)).toEqual(['start', 'done']);
    globalThis.fetch = originalFetch;
  });
});

it('checks the metadata endpoint against the embedded content version', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ content_version: 'different-version' }));

  await expect(new ChatClient().checkCompatibility()).resolves.toBe(false);
  globalThis.fetch = originalFetch;
});

it('rejects start events with incompatible content versions', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      '{\"request_id\":\"r-1\",\"sequence\":1,\"type\":\"start\",\"content_version\":\"different-version\"}\n',
    );

  await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
    code: 'content-incompatible',
    retryable: false,
  });
  globalThis.fetch = originalFetch;
});

it('rejects done events with incompatible content versions', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      [
        '{\"request_id\":\"r-1\",\"sequence\":1,\"type\":\"start\",\"content_version\":\"838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c\"}',
        '{\"request_id\":\"r-1\",\"sequence\":2,\"type\":\"done\",\"content_version\":\"different-version\",\"model\":\"fake\",\"usage\":{\"total_tokens\":4}}',
      ].join('\n'),
    );

  await expect(new ChatClient().stream('Consulta', () => undefined)).rejects.toMatchObject({
    code: 'content-incompatible',
    retryable: false,
  });
  globalThis.fetch = originalFetch;
});

it('retains validated model and usage from done events', () => {
  const started = applyChatEvent(createChatState(), {
    request_id: 'r-1',
    sequence: 1,
    type: 'start',
    content_version: '838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c',
  });
  const complete = applyChatEvent(started, {
    request_id: 'r-1',
    sequence: 2,
    type: 'done',
    content_version: '838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c',
    model: 'fake',
    usage: { total_tokens: 4 },
  });

  expect(complete).toMatchObject({ model: 'fake', usage: { total_tokens: 4 } });
});
