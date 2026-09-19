import { Injectable } from '@angular/core';

import { EXPECTED_CONTENT_VERSION } from './chat-compatibility';
import { API_BASE_URL } from '../../core/config/api-base-url';
import {
  ContactDraft,
  ContactSubmissionResponse,
  InterviewContactFormPart,
  normalizedContactPayload,
  parseContactSubmissionResponse,
  parseInterviewContactFormPart,
} from './contact-form';

export const CHAT_PROTOCOL_VERSION = '5';
export type TextPart = {
  type: 'text';
  text: string;
  grounding: 'general' | 'portfolio';
};
export type SourcePart = { type: 'source'; filename: string; page: number };
export type ChatPart = TextPart | SourcePart | InterviewContactFormPart;

type EventBase = { request_id: string; sequence: number };
export type ChatEvent =
  | (EventBase & {
      type: 'start';
      protocol_version: typeof CHAT_PROTOCOL_VERSION;
      content_version: string;
    })
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

type ChatLogFields = Record<string, string | number | boolean | undefined>;

export function logChatLifecycle(event: string, fields: ChatLogFields): void {
  // Keep browser diagnostics metadata-only: never pass message, SSE data, or text parts.
  console.info('chat_observability', { event, ...fields });
}

export class ChatStreamError extends Error {
  constructor(
    readonly code: typeof INVALID_OUTPUT | typeof STREAM_CLOSED | 'content-incompatible',
    readonly retryable: boolean,
    // Diagnostic only: which validation check tripped. Never shown in the UI;
    // error.code stays the single source for user-facing mapping.
    readonly detail?: string,
  ) {
    super(code);
  }
}

export function createChatState(): ChatState {
  return {
    status: 'idle',
    parts: [],
    announcement: '',
    retryable: false,
    portfolioSearchUsed: false,
    streamedText: '',
  };
}

export function applyChatEvent(state: ChatState, event: ChatEvent): ChatState {
  if (state.requestId && event.request_id !== state.requestId) {
    throw invalid('state-request-mismatch');
  }
  if (state.status === 'complete' || (state.terminalOutcome && event.type !== 'done')) {
    throw invalid('terminal-rules');
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
      return {
        ...state,
        streamedText: state.streamedText + event.text,
        announcement: 'El asistente está respondiendo.',
      };
    case 'part':
      return {
        ...state,
        // The provider preview is intentionally untrusted.  A final server-owned
        // part replaces it atomically, so a completed answer is rendered once even
        // when the provider's last delta is split differently from its final JSON.
        streamedText: '',
        parts: [...state.parts, event.part],
        announcement: 'Se agregó una respuesta respaldada.',
      };
    case 'tool':
      if (state.portfolioSearchUsed || state.parts.length) throw invalid('state-tool-order');
      return {
        ...state,
        portfolioSearchUsed: true,
        announcement: 'Consultando información del portfolio.',
      };
    case 'done':
      return {
        ...state,
        status:
          state.terminalOutcome === 'refusal'
            ? 'refused'
            : state.terminalOutcome === 'error'
              ? 'error'
              : 'complete',
        announcement: state.terminalOutcome ? state.announcement : 'Respuesta completa.',
        retryable: state.terminalOutcome ? state.retryable : false,
        model: event.model,
        usage: event.usage,
      };
    case 'refusal':
      return {
        ...state,
        streamedText: '',
        status: 'refused',
        terminalOutcome: 'refusal',
        announcement: event.message,
        retryable: false,
      };
    case 'error':
      return {
        ...state,
        streamedText: '',
        status: 'error',
        terminalOutcome: 'error',
        announcement: event.message,
        retryable: event.retryable,
      };
  }
}

export function parseSseEvents(sse: string): ChatEvent[] {
  const events = sse
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map(parseSseEvent);
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
  let validatedPartSeen = false;
  for (const event of events.slice(1, -1)) {
    if (terminalOutcomeSeen || event.type === 'start' || event.type === 'done') throw invalid();
    if (event.type === 'text-delta') {
      if (portfolioGroundingSeen || terminalOutcomeSeen) throw invalid();
      continue;
    }
    if (event.type === 'tool') {
      if (portfolioSearchSeen || validatedPartSeen) throw invalid();
      portfolioSearchSeen = true;
      continue;
    }
    if (event.type === 'part') {
      validatedPartSeen = true;
      if (event.part.type === 'text' && event.part.grounding === 'portfolio') {
        if (!portfolioSearchSeen) throw invalid();
        portfolioGroundingSeen = true;
      }
      if (event.part.type === 'source' && !portfolioGroundingSeen) throw invalid();
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
    return parsed.type === event ? parsed : invalid('parse-type-mismatch');
  } catch (error) {
    // Preserve the inner check name so the next failure is self-identifying.
    if (error instanceof ChatStreamError) throw error;
    return invalid('parse');
  }
}

function invalid(detail?: string): never {
  throw new ChatStreamError(INVALID_OUTPUT, false, detail);
}
function text(value: unknown): string {
  // Strict validator for final, server-owned fields. Unchanged on purpose.
  return typeof value === 'string' && value.trim() && !HTML_TAG.test(value)
    ? value
    : invalid('text-validation');
}
function deltaText(value: unknown): string {
  // Preview-only validator. The preview renders via interpolation (chat-page.ts),
  // so Angular escapes it as text and HTML in a delta is inert, not dangerous.
  // Whitespace-only deltas are accepted here and skipped silently in emit().
  return typeof value === 'string' ? value : invalid('delta-text-validation');
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
  if (part['type'] === 'interview_contact_form') {
    try {
      return parseInterviewContactFormPart(part);
    } catch {
      return invalid('contact-form-validation');
    }
  }
  return invalid();
}

function validateEvent(value: unknown): ChatEvent {
  if (!value || typeof value !== 'object') return invalid();
  const raw = value as Record<string, unknown>;
  const base = eventBase(raw);
  if (raw['type'] === 'start')
    return raw['protocol_version'] === CHAT_PROTOCOL_VERSION
      ? {
          ...base,
          type: 'start',
          protocol_version: CHAT_PROTOCOL_VERSION,
          content_version: text(raw['content_version']),
        }
      : invalid();
  if (raw['type'] === 'text-delta')
    return { ...base, type: 'text-delta', text: deltaText(raw['text']) };
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
  private contactFormSupported = false;

  async checkCompatibility(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/metadata`);
      if (!response.ok) return false;
      const metadata = (await response.json()) as {
        content_version?: unknown;
        protocol_version?: unknown;
        capabilities?: unknown;
      };
      const capabilities = metadata.capabilities;
      this.contactFormSupported =
        !!capabilities &&
        typeof capabilities === 'object' &&
        (capabilities as Record<string, unknown>)['interview_contact_form'] === '1' &&
        (capabilities as Record<string, unknown>)['contact_submission'] === '1';
      return (
        metadata.content_version === this.expectedContentVersion &&
        metadata.protocol_version === CHAT_PROTOCOL_VERSION
      );
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
    const startedAt = performance.now();
    logChatLifecycle('chat.request_started', { client_request_id: clientRequestId });
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          locale: 'es',
          client_request_id: clientRequestId,
          ...(this.contactFormSupported
            ? { capabilities: { interview_contact_form: '1', contact_submission: '1' } }
            : {}),
        }),
        signal,
      });
    } catch {
      logChatLifecycle(signal?.aborted ? 'chat.request_aborted' : 'chat.request_error', {
        client_request_id: clientRequestId,
        terminal_outcome: signal?.aborted ? 'aborted' : 'network-error',
        error_code: signal?.aborted ? 'aborted' : 'provider-unavailable',
        retryable: !signal?.aborted,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      throw new Error('provider-unavailable');
    }
    const contentType = response.headers.get('content-type') ?? 'missing';
    logChatLifecycle('chat.response_accepted', {
      client_request_id: clientRequestId,
      status_code: response.status,
      content_type: contentType.split(';', 1)[0],
      elapsed_ms: Math.round(performance.now() - startedAt),
    });
    if (!response.ok || !response.body || !contentType.startsWith('text/event-stream')) {
      logChatLifecycle('chat.request_error', {
        client_request_id: clientRequestId,
        status_code: response.status,
        content_type: contentType.split(';', 1)[0],
        error_code: 'provider-unavailable',
        retryable: true,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
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
    let validatedPartSeen = false;
    const emit = (event: ChatEvent): void => {
      if (
        (expectedSequence === 1) !== (event.type === 'start') ||
        doneSeen ||
        event.sequence !== expectedSequence ||
        (requestId && requestId !== event.request_id)
      )
        return invalid('emit-precondition');
      if (terminalOutcomeSeen && event.type !== 'done') return invalid('terminal-rules');
      if (event.type === 'text-delta' && portfolioGroundingSeen)
        return invalid('delta-after-grounding');
      // A whitespace-only delta carries no visible preview signal (the live
      // model emits them between tokens). It still consumes exactly one valid
      // protocol sequence before being hidden from the UI.
      if (event.type === 'text-delta' && !event.text.trim()) {
        expectedSequence += 1;
        logChatLifecycle('chat.event_dropped', {
          client_request_id: clientRequestId,
          request_id: event.request_id,
          event_type: event.type,
          sequence: event.sequence,
          detail: 'whitespace-preview-skipped',
        });
        return;
      }
      if (event.type === 'tool') {
        if (portfolioSearchSeen || validatedPartSeen) return invalid('tool-order');
        portfolioSearchSeen = true;
      }
      if (event.type === 'part') {
        validatedPartSeen = true;
        if (event.part.type === 'text' && event.part.grounding === 'portfolio') {
          if (!portfolioSearchSeen) return invalid('part-without-tool');
          portfolioGroundingSeen = true;
        }
        if (event.part.type === 'source' && !portfolioGroundingSeen)
          return invalid('source-without-grounding');
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
      logChatLifecycle('chat.event_received', {
        client_request_id: clientRequestId,
        request_id: event.request_id,
        event_type: event.type,
        sequence: event.sequence,
        ...(event.type === 'error' || event.type === 'refusal'
          ? { error_code: event.code, retryable: event.retryable }
          : {}),
      });
      onEvent(event);
    };
    const parseAndEmit = (frame: string): void => {
      try {
        emit(parseSseEvent(frame));
      } catch (error) {
        const streamError =
          error instanceof ChatStreamError
            ? error
            : new ChatStreamError('invalid-provider-output', false);
        logChatLifecycle('chat.request_error', {
          client_request_id: clientRequestId,
          request_id: requestId,
          error_code: streamError.code,
          retryable: streamError.retryable,
          ...(streamError.detail ? { error_detail: streamError.detail } : {}),
          elapsed_ms: Math.round(performance.now() - startedAt),
        });
        throw error;
      }
    };
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        logChatLifecycle(signal?.aborted ? 'chat.stream_aborted' : 'chat.request_error', {
          client_request_id: clientRequestId,
          request_id: requestId,
          terminal_outcome: signal?.aborted ? 'aborted' : 'read-error',
          error_code: signal?.aborted ? 'aborted' : 'provider-unavailable',
          retryable: !signal?.aborted,
          elapsed_ms: Math.round(performance.now() - startedAt),
        });
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
      complete
        .split(/\r?\n\r?\n/)
        .filter(Boolean)
        .forEach(parseAndEmit);
    }
    if (pending.trim()) {
      logChatLifecycle('chat.request_error', {
        client_request_id: clientRequestId,
        request_id: requestId,
        error_code: INVALID_OUTPUT,
        retryable: false,
        error_detail: 'pending-leftover',
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      throw invalid('pending-leftover');
    }
    if (!doneSeen) {
      logChatLifecycle('chat.request_error', {
        client_request_id: clientRequestId,
        request_id: requestId,
        error_code: STREAM_CLOSED,
        retryable: true,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      throw new ChatStreamError(STREAM_CLOSED, true);
    }
    logChatLifecycle('chat.stream_completed', {
      client_request_id: clientRequestId,
      request_id: requestId,
      terminal_outcome: terminalOutcomeSeen ? 'terminal-event' : 'done',
      elapsed_ms: Math.round(performance.now() - startedAt),
    });
  }

  async submitContact(
    draft: ContactDraft,
    idempotencyKey: string,
  ): Promise<ContactSubmissionResponse> {
    const startedAt = performance.now();
    logChatLifecycle('contact.request_started', {});
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v1/contact/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(normalizedContactPayload(draft)),
      });
    } catch {
      logChatLifecycle('contact.request_error', {
        error_code: 'network-error',
        retryable: true,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      throw new Error('contact-unavailable');
    }
    let result: ContactSubmissionResponse;
    try {
      result = parseContactSubmissionResponse(await response.json());
    } catch {
      logChatLifecycle('contact.request_error', {
        status_code: response.status,
        error_code: 'invalid-contact-response',
        retryable: false,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      throw new Error('invalid-contact-response');
    }
    logChatLifecycle('contact.request_completed', {
      status_code: response.status,
      terminal_outcome: result.outcome,
      retryable: result.retryable,
      elapsed_ms: Math.round(performance.now() - startedAt),
    });
    return result;
  }
}
