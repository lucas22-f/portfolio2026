import { TestBed } from '@angular/core/testing';

import { ChatClient, ChatEvent, ChatStreamError } from './chat-client';
import { ChatPage } from './chat-page';

describe('ChatPage', () => {
  it('focuses its accessible entry heading only when focusOnEntry is requested', async () => {
    const client = { checkCompatibility: async () => true, stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentRef.setInput('focusOnEntry', true);
    fixture.detectChanges();

    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-testid="chat-heading"]'),
    );
    expect(fixture.nativeElement.querySelector('[data-testid="chat-heading"]')?.tagName).toBe('H3');
  });

  it('announces a Spanish grounded response and renders only its text part', async () => {
    const client = {
      checkCompatibility: async () => true,
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({
          request_id: 'r-1',
          sequence: 1,
          type: 'start',
          protocol_version: '5',
          content_version: 'v1',
        });
        onEvent({
          request_id: 'r-1',
          sequence: 2,
          type: 'part',
          part: {
            type: 'text',
            grounding: 'portfolio',
            text: 'Respuesta respaldada.',
          },
        });
        onEvent({
          request_id: 'r-1',
          sequence: 3,
          type: 'done',
          protocol_version: '5',
          content_version: 'v1',
        });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentInstance.message = '¿Qué proyectos realizó?';
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Respuesta completa.',
    );
    expect(page.querySelector('[aria-label="Respuesta del asistente"]')?.textContent).toContain(
      'Respuesta respaldada.',
    );
    expect(page.textContent).toContain('Basada en el portfolio');
    expect(page.querySelector('label[for="chat-message"]')?.textContent).toContain('Tu consulta');
  });

  it('renders safe activity and groups server-owned citations with a grounded answer', async () => {
    const client = {
      checkCompatibility: async () => true,
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({
          request_id: 'r-1',
          sequence: 1,
          type: 'start',
          protocol_version: '5',
          content_version: 'v1',
        });
        onEvent({ request_id: 'r-1', sequence: 2, type: 'tool', tool: 'search_portfolio' });
        onEvent({
          request_id: 'r-1',
          sequence: 3,
          type: 'part',
          part: { type: 'text', grounding: 'portfolio', text: 'Respuesta respaldada.' },
        });
        onEvent({
          request_id: 'r-1',
          sequence: 4,
          type: 'part',
          part: { type: 'source', filename: 'CV.pdf', page: 3 },
        });
        onEvent({
          request_id: 'r-1',
          sequence: 5,
          type: 'done',
          protocol_version: '5',
          content_version: 'v1',
        });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentInstance.message = 'Consulta';

    await fixture.componentInstance.submit();
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('[data-testid="assistant-activity"]')?.textContent).toContain(
      'Respuesta completada con información del portfolio',
    );
    expect(page.querySelector('[data-testid="chat-sources"]')?.textContent).toContain(
      'Fuentes consultadas',
    );
    expect(page.querySelector('[data-testid="chat-sources"]')?.textContent).toContain(
      'CV.pdf, página 3',
    );
    expect(page.textContent).not.toContain('Fuente:');
  });

  it('keeps consecutive successful turns in chronological transcript order without duplicates', async () => {
    let call = 0;
    const client = {
      checkCompatibility: async () => true,
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        call += 1;
        const requestId = `r-${call}`;
        const response = call === 1 ? 'Primera respuesta.' : 'Segunda respuesta.';
        onEvent({
          request_id: requestId,
          sequence: 1,
          type: 'start',
          protocol_version: '5',
          content_version: 'v1',
        });
        onEvent({
          request_id: requestId,
          sequence: 2,
          type: 'part',
          part: { type: 'text', grounding: 'general', text: response },
        });
        onEvent({
          request_id: requestId,
          sequence: 3,
          type: 'done',
          protocol_version: '5',
          content_version: 'v1',
        });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentInstance.message = 'Primera consulta.';
    await fixture.componentInstance.submit();
    fixture.componentInstance.message = 'Segunda consulta.';
    await fixture.componentInstance.submit();
    fixture.detectChanges();

    const transcript =
      fixture.nativeElement.querySelector('[data-testid="chat-transcript"]')?.textContent ?? '';
    expect(transcript.indexOf('Primera consulta.')).toBeLessThan(
      transcript.indexOf('Primera respuesta.'),
    );
    expect(transcript.indexOf('Primera respuesta.')).toBeLessThan(
      transcript.indexOf('Segunda consulta.'),
    );
    expect(transcript.indexOf('Segunda consulta.')).toBeLessThan(
      transcript.indexOf('Segunda respuesta.'),
    );
    expect(transcript.match(/Primera consulta\./g)).toHaveLength(1);
    expect(transcript.match(/Segunda consulta\./g)).toHaveLength(1);
  });

  it('derives only safe lifecycle labels from validated chat state', async () => {
    const client = { checkCompatibility: async () => true, stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    const state = (overrides: Partial<ReturnType<typeof fixture.componentInstance.state>>) =>
      fixture.componentInstance.state.set({
        status: 'streaming',
        parts: [],
        announcement: '',
        retryable: false,
        portfolioSearchUsed: false,
        streamedText: '',
        ...overrides,
      });

    state({});
    expect(fixture.componentInstance.activityLabel()).toBe('Preparando respuesta');
    state({ portfolioSearchUsed: true });
    expect(fixture.componentInstance.activityLabel()).toBe('Consultando información del portfolio');
    state({ portfolioSearchUsed: false, streamedText: 'Parcial' });
    expect(fixture.componentInstance.activityLabel()).toBe('Generando respuesta');
    state({ status: 'complete', portfolioSearchUsed: true, streamedText: '' });
    expect(fixture.componentInstance.activityLabel()).toBe(
      'Respuesta completada con información del portfolio',
    );
  });

  it('keeps invalid provider output on the safe non-retryable validation path', async () => {
    const client = {
      checkCompatibility: async () => true,
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({
          request_id: 'r-1',
          sequence: 1,
          type: 'start',
          protocol_version: '5',
          content_version: 'v1',
        });
        onEvent({
          request_id: 'r-1',
          sequence: 2,
          type: 'text-delta',
          text: 'Vista previa sin validar.',
        });
        throw Object.assign(new Error('invalid-provider-output'), {
          code: 'invalid-provider-output',
          retryable: false,
        });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentInstance.message = 'Consulta';

    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'No pude validar la respuesta.',
    );
    expect(page.textContent).not.toContain('Reintentar');
    expect(page.querySelector('[data-testid="streaming-assistant-text"]')).toBeNull();
    expect(page.textContent).not.toContain('Vista previa sin validar.');
    expect(fixture.componentInstance.state().retryable).toBe(false);
  });

  it('exits streaming and offers retry when the stream closes early', async () => {
    const client = {
      checkCompatibility: async () => true,
      stream: async () => {
        throw new ChatStreamError('stream-closed', true);
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentInstance.message = 'Consulta';

    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.state().status).toBe('error');
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'No pude completar la respuesta.',
    );
    expect(page.textContent).toContain('Reintentar');
  });

  it('disables only chat when metadata is incompatible', async () => {
    const client = { checkCompatibility: async () => false, stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('chat');
    expect((page.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('uses Tailwind controls that preserve the chat input and action touch contract', async () => {
    const client = { checkCompatibility: async () => true, stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('section')?.classList.contains('min-h-svh')).toBe(true);
    expect(page.querySelector('section > div')?.classList.contains('max-w-4xl')).toBe(true);
    expect(page.querySelector('section > div')?.classList.contains('sm:px-8')).toBe(true);
    expect(page.querySelector('textarea')?.classList.contains('min-h-24')).toBe(true);
    expect(page.querySelector('button[type="submit"]')?.classList.contains('min-h-11')).toBe(true);
  });

  it('emits the composer return action without submitting a chat message', async () => {
    const client = { checkCompatibility: async () => true, stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    let returnCount = 0;
    fixture.componentInstance.returnToIntro.subscribe(() => {
      returnCount += 1;
    });
    fixture.detectChanges();

    const action = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="reset-journey"]',
    )!;
    action.click();

    expect(action.type).toBe('button');
    expect(action.closest('[data-testid="chat-composer"]')).not.toBeNull();
    expect(returnCount).toBe(1);
  });

  it('keeps a natural-height conversation with a bounded transcript scroller', async () => {
    const client = { checkCompatibility: async () => true, stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[data-testid="chat-viewport"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="chat-transcript"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="chat-composer"]')).not.toBeNull();
    expect(
      page.querySelector('[data-testid="chat-viewport"]')?.classList.contains('min-h-svh'),
    ).toBe(true);
    expect(
      page.querySelector('[data-testid="chat-transcript"]')?.classList.contains('overflow-y-auto'),
    ).toBe(true);
  });

  it('places a closed contact suggestion after completed response text without stealing focus', async () => {
    const client = {
      checkCompatibility: async () => true,
      submitContact: async () => ({ outcome: 'accepted', retryable: false, request_id: 'safe-id' }),
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({
          request_id: 'contact-1',
          sequence: 1,
          type: 'start',
          protocol_version: '5',
          content_version: 'v1',
        });
        onEvent({
          request_id: 'contact-1',
          sequence: 2,
          type: 'part',
          part: { type: 'text', grounding: 'general', text: 'Podemos conversar.' },
        });
        onEvent({
          request_id: 'contact-1',
          sequence: 3,
          type: 'part',
          part: {
            type: 'interview_contact_form',
            form_version: '1',
            submission_version: '1',
            intent: 'interview',
            fields: ['name', 'email', 'company', 'message'],
          },
        });
        onEvent({
          request_id: 'contact-1',
          sequence: 4,
          type: 'done',
          protocol_version: '5',
          content_version: 'v1',
        });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentInstance.message = 'Quiero una entrevista.';
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const transcript = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="chat-transcript"]',
    )!;
    expect(transcript.textContent!.indexOf('Podemos conversar.')).toBeLessThan(
      transcript.textContent!.indexOf('Abrir formulario'),
    );
    expect(transcript.querySelector('app-interview-contact-form form')).toBeNull();
    expect(document.activeElement?.textContent).not.toContain('Enviar una consulta a Lucas');
  });
});
