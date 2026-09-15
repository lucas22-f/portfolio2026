import { Injectable } from '@angular/core';

import { EXPECTED_CONTENT_VERSION } from './chat-compatibility';
import { API_BASE_URL } from '../../core/config/api-base-url';

export const CHAT_PROTOCOL_VERSION = '5';
export type TextPart = {
  type: 'text'; text: string; grounding: 'general' | 'portfolio';
};
export type SourcePart = { type: 'source'; filename: string; page: number };
export type ChatPart = TextPart | SourcePart;

type EventBase = { request_id: string; sequence: number };
export type ChatEvent =
  | (EventBase & { type: 'start'; protocol_version: typeof CHAT_PROTOCOL_VERSION; content_version: string })
  | (EventBase & { type: 'text-delta'; text: string })
  | (EventBase & { type: 'tool'; tool: 'search_portfolio' })
  | (EventBase & { type: 'part'; part: ChatPart })
  | (EventBase & { type: 'refusal' | 'error'; code: string; message: string; retryable: boolean })
  | (EventBase & {
      type: 'done';
      protocol_version: typeof CHAT_PROTOCOL_VERSION;
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
  terminalOutcome?: 'refusal' | 'error';
  portfolioSearchUsed: boolean;
  streamedText: string;
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
  return { status: 'idle', parts: [], announcement: '', retryable: false, portfolioSearchUsed: false, streamedText: '' };
}

export function applyChatEvent(state: ChatState, event: ChatEvent): ChatState {
  if (state.requestId && event.request_id !== state.requestId) {
    throw invalid();
  }
  if (state.status === 'complete' || (state.terminalOutcome && event.type !== 'done')) {
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
    case 'text-delta':
      return { ...state, streamedText: state.streamedText + event.text, announcement: 'El asistente está respondiendo.' };
    case 'part':
      return {
        ...state,
        streamedText: '',
        parts: [...state.parts, event.part],
        announcement: 'Se agregó una respuesta respaldada.',
      };
    case 'tool':
      if (state.portfolioSearchUsed || state.parts.length) throw invalid();
      return {
        ...state,
        portfolioSearchUsed: true,
        announcement: 'Consultando información del portfolio.',
      };
    case 'done':
      return {
        ...state,
        status: state.terminalOutcome === 'refusal' ? 'refused' : state.terminalOutcome === 'error' ? 'error' : 'complete',
        announcement: state.terminalOutcome ? state.announcement : 'Respuesta completa.',
        retryable: state.terminalOutcome ? state.retryable : false,
        model: event.model,
        usage: event.usage,
      };
    case 'refusal':
      return { ...state, streamedText: '', status: 'refused', terminalOutcome: 'refusal', announcement: event.message, retryable: false };
    case 'error':
      return { ...state, streamedText: '', status: 'error', terminalOutcome: 'error', announcement: event.message, retryable: event.retryable };
  }
}

export function parseSseEvents(sse: string): ChatEvent[] {
  const events = sse.split(/\r?\n\r?\n/).filter(Boolean).map(parseSseEvent);
  let sequence = 1;
  let requestId: string | undefined;
  for (const event of events) {
    if (event.sequence !== sequence || (requestId && event.request_id !== requestId))
      throw invalid();
    requestId ??= event.request_id;
    sequence += 1;
  }
  if (events[0]?.type !== 'start' || events.at(-1)?.type !== 'done') throw invalid();
  let terminalOutcomeSeen = false;
  let portfolioSearchSeen = false;
  let portfolioGroundingSeen = false;
  for (const [index, event] of events.slice(1, -1).entries()) {
    if (terminalOutcomeSeen || event.type === 'start' || event.type === 'done') throw invalid();
    if (event.type === 'text-delta') {
      if (portfolioGroundingSeen || terminalOutcomeSeen) throw invalid();
      continue;
    }
    if (event.type === 'tool') {
      if (portfolioSearchSeen || index !== 0) throw invalid();
      portfolioSearchSeen = true;
      continue;
    }
    if (event.type === 'part') {
      if (event.part.type === 'text' && event.part.grounding === 'portfolio') {
        if (!portfolioSearchSeen) throw invalid();
        portfolioGroundingSeen = true;
      }
      if (event.part.type === 'source' && !portfolioGroundingSeen)
        throw invalid();
    }
    terminalOutcomeSeen = event.type === 'refusal' || event.type === 'error';
  }
  return events;
}

export function parseSseEvent(frame: string): ChatEvent {
  try {
    const fields = frame.split(/\r?\n/);
    const event = fields.find((field) => field.startsWith('event: '))?.slice(7);
    const data = fields.find((field) => field.startsWith('data: '))?.slice(6);
    if (!event || !data || fields.length !== 2) return invalid();
    const parsed = validateEvent(JSON.parse(data));
    return parsed.type === event ? parsed : invalid();
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
  if (part['type'] === 'text') {
    const grounding =
      part['grounding'] === 'general' || part['grounding'] === 'portfolio'
        ? part['grounding']
        : invalid();
    return {
      type: 'text',
      text: text(part['text']),
      grounding,
    };
  }
  if (part['type'] === 'source')
    return typeof part['page'] === 'number' && Number.isInteger(part['page']) && part['page'] > 0
      ? { type: 'source', filename: text(part['filename']), page: part['page'] }
      : invalid();
  return invalid();
}

function validateEvent(value: unknown): ChatEvent {
  if (!value || typeof value !== 'object') return invalid();
  const raw = value as Record<string, unknown>;
  const base = eventBase(raw);
  if (raw['type'] === 'start')
    return raw['protocol_version'] === CHAT_PROTOCOL_VERSION
      ? { ...base, type: 'start', protocol_version: CHAT_PROTOCOL_VERSION, content_version: text(raw['content_version']) }
      : invalid();
  if (raw['type'] === 'text-delta') return { ...base, type: 'text-delta', text: text(raw['text']) };
  if (raw['type'] === 'tool')
    return raw['tool'] === 'search_portfolio'
      ? { ...base, type: 'tool', tool: 'search_portfolio' }
      : invalid();
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
    if (raw['protocol_version'] !== CHAT_PROTOCOL_VERSION) return invalid();
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
      protocol_version: CHAT_PROTOCOL_VERSION,
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
      const response = await fetch(`${API_BASE_URL}/api/v1/metadata`);
      if (!response.ok) return false;
      const metadata = (await response.json()) as { content_version?: unknown; protocol_version?: unknown };
      return metadata.content_version === this.expectedContentVersion && metadata.protocol_version === CHAT_PROTOCOL_VERSION;
    } catch {
      return false;
    }
  }

  async stream(
    message: string,
    onEvent: (event: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const clientRequestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, locale: 'es', client_request_id: clientRequestId }),
        signal,
      });
    } catch {
      throw new Error('provider-unavailable');
    }
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
      throw new Error('provider-unavailable');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let expectedSequence = 1;
    let requestId: string | undefined;
    let terminalOutcomeSeen = false;
    let doneSeen = false;
    let portfolioSearchSeen = false;
    let portfolioGroundingSeen = false;
    const emit = (event: ChatEvent): void => {
      if (
        (expectedSequence === 1) !== (event.type === 'start') ||
        doneSeen ||
        event.sequence !== expectedSequence ||
        (requestId && requestId !== event.request_id)
      )
        return invalid();
      if (terminalOutcomeSeen && event.type !== 'done') return invalid();
      if (event.type === 'text-delta' && (portfolioGroundingSeen || terminalOutcomeSeen)) {
        return invalid();
      }
      if (event.type === 'tool') {
        if (portfolioSearchSeen || expectedSequence !== 2) return invalid();
        portfolioSearchSeen = true;
      }
      if (event.type === 'part') {
        if (event.part.type === 'text' && event.part.grounding === 'portfolio') {
          if (!portfolioSearchSeen) return invalid();
          portfolioGroundingSeen = true;
        }
        if (event.part.type === 'source' && !portfolioGroundingSeen)
          return invalid();
      }
      if (
        (event.type === 'start' || event.type === 'done') &&
        event.content_version !== this.expectedContentVersion
      ) {
        throw new ChatStreamError('content-incompatible', false);
      }
      requestId ??= event.request_id;
      expectedSequence += 1;
      terminalOutcomeSeen ||= event.type === 'error' || event.type === 'refusal';
      doneSeen ||= event.type === 'done';
      onEvent(event);
    };
    const parseAndEmit = (frame: string): void => emit(parseSseEvent(frame));
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new Error('provider-unavailable');
      }
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const boundary = /\r?\n\r?\n/g;
      let match: RegExpExecArray | null;
      let lastBoundary: RegExpExecArray | undefined;
      while ((match = boundary.exec(pending)) !== null) lastBoundary = match;
      const index = lastBoundary?.index ?? -1;
      if (index < 0) continue;
      const complete = pending.slice(0, index);
      pending = pending.slice(index + lastBoundary![0].length);
      complete.split(/\r?\n\r?\n/).filter(Boolean).forEach(parseAndEmit);
    }
    if (pending.trim()) throw invalid();
    if (!doneSeen) {
      throw new ChatStreamError(STREAM_CLOSED, true);
    }
  }
}








