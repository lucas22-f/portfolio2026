import { Injectable } from '@angular/core';

import { EXPECTED_CONTENT_VERSION } from './chat-compatibility';

export type TextPart = { type: 'text'; text: string; record_ids: string[]; claim_ids: string[] };
export type SourcePart = { type: 'source'; record_id: string; label: string };
export type ProjectCardPart = {
  type: 'project-card';
  record_id: string;
  title: string;
  summary: string;
  links: Array<{ label: string; url: string }>;
};
export type ChatPart = TextPart | SourcePart | ProjectCardPart;

type EventBase = { request_id: string; sequence: number };
export type ChatEvent =
  | (EventBase & { type: 'start'; content_version: string })
  | (EventBase & { type: 'part'; part: ChatPart })
  | (EventBase & { type: 'refusal' | 'error'; code: string; message: string; retryable: boolean })
  | (EventBase & {
      type: 'done';
      content_version: string;
      model?: string;
      usage?: ChatUsage;
    });

export type ChatUsage = { total_tokens?: number };

export type ChatStatus = 'idle' | 'streaming' | 'complete' | 'refused' | 'error';
export type ChatState = {
  status: ChatStatus;
  requestId?: string;
  parts: ChatPart[];
  announcement: string;
  retryable: boolean;
  model?: string;
  usage?: ChatUsage;
};

const INVALID_OUTPUT = 'invalid-provider-output';
const STREAM_CLOSED = 'stream-closed';
const HTML_TAG = /<\s*\/?[a-z][^>]*>/i;

export class ChatStreamError extends Error {
  constructor(
    readonly code: typeof INVALID_OUTPUT | typeof STREAM_CLOSED | 'content-incompatible',
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export function createChatState(): ChatState {
  return { status: 'idle', parts: [], announcement: '', retryable: false };
}

export function applyChatEvent(state: ChatState, event: ChatEvent): ChatState {
  if (state.requestId && event.request_id !== state.requestId) {
    throw invalid();
  }
  if (['complete', 'refused', 'error'].includes(state.status)) {
    throw invalid();
  }

  switch (event.type) {
    case 'start':
      return {
        ...createChatState(),
        status: 'streaming',
        requestId: event.request_id,
        announcement: 'Recibiendo respuesta.',
      };
    case 'part':
      return {
        ...state,
        parts: [...state.parts, event.part],
        announcement: 'Se agregó una respuesta respaldada.',
      };
    case 'done':
      return {
        ...state,
        status: 'complete',
        announcement: 'Respuesta completa.',
        retryable: false,
        model: event.model,
        usage: event.usage,
      };
    case 'refusal':
      return { ...state, status: 'refused', announcement: event.message, retryable: false };
    case 'error':
      return { ...state, status: 'error', announcement: event.message, retryable: event.retryable };
  }
}

export function parseNdjsonEvents(ndjson: string): ChatEvent[] {
  const lines = ndjson
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const events = lines.map((line) => parseNdjsonEvent(line));
  let sequence = 1;
  let requestId: string | undefined;
  for (const event of events) {
    if (event.sequence !== sequence || (requestId && event.request_id !== requestId))
      throw invalid();
    requestId ??= event.request_id;
    sequence += 1;
  }
  return events;
}

export function parseNdjsonEvent(line: string): ChatEvent {
  try {
    return validateEvent(JSON.parse(line));
  } catch {
    return invalid();
  }
}

function invalid(): never {
  throw new ChatStreamError(INVALID_OUTPUT, false);
}
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() && !HTML_TAG.test(value) ? value : invalid();
}
function ids(value: unknown): string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string') ? value : invalid();
}
function eventBase(value: Record<string, unknown>): EventBase {
  return typeof value['request_id'] === 'string' &&
    Number.isInteger(value['sequence']) &&
    (value['sequence'] as number) > 0
    ? { request_id: value['request_id'], sequence: value['sequence'] as number }
    : invalid();
}

function validatePart(value: unknown): ChatPart {
  if (!value || typeof value !== 'object') return invalid();
  const part = value as Record<string, unknown>;
  if (part['type'] === 'text')
    return {
      type: 'text',
      text: text(part['text']),
      record_ids: ids(part['record_ids']),
      claim_ids: ids(part['claim_ids']),
    };
  if (part['type'] === 'source')
    return { type: 'source', record_id: text(part['record_id']), label: text(part['label']) };
  if (part['type'] === 'project-card') {
    if (!Array.isArray(part['links'])) return invalid();
    return {
      type: 'project-card',
      record_id: text(part['record_id']),
      title: text(part['title']),
      summary: text(part['summary']),
      links: part['links'].map((link) => {
        if (!link || typeof link !== 'object') return invalid();
        const item = link as Record<string, unknown>;
        const url = text(item['url']);
        if (!/^https:\/\//.test(url)) return invalid();
        return { label: text(item['label']), url };
      }),
    };
  }
  return invalid();
}

function validateEvent(value: unknown): ChatEvent {
  if (!value || typeof value !== 'object') return invalid();
  const raw = value as Record<string, unknown>;
  const base = eventBase(raw);
  if (raw['type'] === 'start')
    return { ...base, type: 'start', content_version: text(raw['content_version']) };
  if (raw['type'] === 'part') return { ...base, type: 'part', part: validatePart(raw['part']) };
  if (raw['type'] === 'refusal' || raw['type'] === 'error')
    return typeof raw['retryable'] === 'boolean'
      ? {
          ...base,
          type: raw['type'],
          code: text(raw['code']),
          message: text(raw['message']),
          retryable: raw['retryable'],
        }
      : invalid();
  if (raw['type'] === 'done') {
    const model = text(raw['model']);
    const usage = raw['usage'];
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return invalid();
    const totalTokens = (usage as Record<string, unknown>)['total_tokens'];
    if (
      totalTokens !== undefined &&
      (!Number.isInteger(totalTokens) || (totalTokens as number) < 0)
    )
      return invalid();
    return {
      ...base,
      type: 'done',
      content_version: text(raw['content_version']),
      model,
      usage: { ...(totalTokens === undefined ? {} : { total_tokens: totalTokens as number }) },
    };
  }
  return invalid();
}

@Injectable({ providedIn: 'root' })
export class ChatClient {
  private readonly expectedContentVersion = EXPECTED_CONTENT_VERSION;

  async checkCompatibility(): Promise<boolean> {
    try {
      const response = await fetch('/api/v1/metadata');
      if (!response.ok) return false;
      const metadata = (await response.json()) as { content_version?: unknown };
      return metadata.content_version === this.expectedContentVersion;
    } catch {
      return false;
    }
  }

  async stream(
    message: string,
    onEvent: (event: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, locale: 'es', client_request_id: crypto.randomUUID() }),
      signal,
    });
    if (!response.ok || !response.body) throw new Error('provider-unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let expectedSequence = 1;
    let requestId: string | undefined;
    let terminalSeen = false;
    const emit = (event: ChatEvent): void => {
      if (
        (expectedSequence === 1) !== (event.type === 'start') ||
        terminalSeen ||
        event.sequence !== expectedSequence ||
        (requestId && requestId !== event.request_id)
      )
        return invalid();
      if (
        (event.type === 'start' || event.type === 'done') &&
        event.content_version !== this.expectedContentVersion
      ) {
        throw new ChatStreamError('content-incompatible', false);
      }
      requestId ??= event.request_id;
      expectedSequence += 1;
      terminalSeen = ['done', 'error', 'refusal'].includes(event.type);
      onEvent(event);
    };
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const index = pending.lastIndexOf('\n');
      if (index < 0) continue;
      const complete = pending.slice(0, index);
      pending = pending.slice(index + 1);
      complete.split('\n').filter(Boolean).map(parseNdjsonEvent).forEach(emit);
    }
    if (pending.trim()) {
      emit(parseNdjsonEvent(pending));
    }
    if (!terminalSeen) throw new ChatStreamError(STREAM_CLOSED, true);
  }
}
