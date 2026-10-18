import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ChatClient, ChatEvent, ChatStreamError } from './chat-client';
import { ChatPage } from './chat-page';

describe('ChatPage', () => {
  async function waitForCompatibility(fixture: ComponentFixture<ChatPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows an accessible initialization status while compatibility is pending', async () => {
    const client = {
      checkCompatibility: () => new Promise<'transient'>(() => undefined),
      stream: async () => undefined,
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();

    const gate = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="compatibility-gate"]',
    );
    expect(gate?.getAttribute('role')).toBe('dialog');
    expect(gate?.getAttribute('aria-modal')).toBe('true');
    expect(gate?.textContent).toContain('Verificando la disponibilidad del chat');
    expect(gate?.textContent).toContain('Después de un período sin actividad');
    expect(gate?.querySelector('hlm-spinner')).not.toBeNull();
    expect(document.activeElement).toBe(gate);
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="chat-composer"]')
        ?.parentElement?.hasAttribute('inert'),
    ).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('textarea')?.hasAttribute('disabled'),
    ).toBe(true);
  });

  it('keeps initializing through a transient compatibility failure and enables chat on retry', async () => {
    vi.useFakeTimers();
    const client = {
      checkCompatibility: vi
        .fn()
        .mockResolvedValueOnce('transient')
        .mockResolvedValueOnce('compatible'),
      stream: async () => undefined,
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(10_000);
    fixture.detectChanges();

    expect(client.checkCompatibility).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.compatibilityPending()).toBe(false);
    expect(fixture.componentInstance.compatible()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="compatibility-gate"]'),
    ).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('textarea')?.disabled).toBe(false);
    vi.useRealTimers();
  });

  it('allows retry after transient compatibility exhaustion and recovers on success', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let resolveRecovery: ((result: 'compatible') => void) | undefined;
    const client = {
      checkCompatibility: vi.fn(() => {
        attempts += 1;
        if (attempts <= 6) return Promise.resolve('transient' as const);
        return new Promise<'compatible'>((resolve) => {
          resolveRecovery = resolve;
        });
      }),
      stream: async () => undefined,
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(60_000);
    fixture.detectChanges();

    expect(client.checkCompatibility).toHaveBeenCalledTimes(6);
    expect(fixture.componentInstance.compatibilityPending()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent,
    ).toContain('chat no está disponible temporalmente');
    const retryButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="retry-compatibility"]',
    );
    expect(retryButton?.textContent).toContain('Reintentar');

    retryButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(client.checkCompatibility).toHaveBeenCalledTimes(7);
    expect(fixture.componentInstance.compatibilityPending()).toBe(true);
    const gate = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="compatibility-gate"]',
    );
    expect(document.activeElement).toBe(gate);
    resolveRecovery?.('compatible');
    await waitForCompatibility(fixture);

    expect(fixture.componentInstance.compatible()).toBe(true);
    expect(fixture.componentInstance.compatibilityPending()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="compatibility-gate"]'),
    ).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('textarea')?.disabled).toBe(false);
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-testid="chat-heading"]'),
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('surfaces an incompatible metadata response without retrying', async () => {
    const client = {
      checkCompatibility: vi.fn().mockResolvedValue('incompatible'),
      stream: async () => undefined,
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);

    expect(client.checkCompatibility).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.compatibilityPending()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent,
    ).toContain('chat no está disponible temporalmente');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="retry-compatibility"]'),
    ).toBeNull();
  });

  it('focuses its accessible entry heading only when focusOnEntry is requested', async () => {
    const client = { checkCompatibility: async () => 'compatible', stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentRef.setInput('focusOnEntry', true);
    await waitForCompatibility(fixture);

    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-testid="chat-heading"]'),
    );
    expect(fixture.nativeElement.querySelector('[data-testid="chat-heading"]')?.tagName).toBe('H3');
  });

  it('focuses its entry heading without scrolling the page', async () => {
    const client = { checkCompatibility: async () => 'compatible', stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
    const heading = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="chat-heading"]',
    )!;
    const focus = vi.spyOn(heading, 'focus');

    fixture.componentInstance.focusEntry();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(heading);
  });

  it('announces a Spanish grounded response and renders only its text part', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
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
    await waitForCompatibility(fixture);
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

  it('renders a labeled accessible CV download button bound to the fixed local PDF', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({ request_id: 'cv-1', sequence: 1, type: 'start', protocol_version: '5', content_version: 'v1' });
        onEvent({
          request_id: 'cv-1', sequence: 2, type: 'part',
          part: { type: 'cv_download', href: '/downloads/CV_Lucas_Figueroa.pdf', label: 'Descargar CV de Lucas' },
        });
        onEvent({ request_id: 'cv-1', sequence: 3, type: 'done', protocol_version: '5', content_version: 'v1' });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
    fixture.componentInstance.message = 'Quiero el CV de Lucas';
    await fixture.componentInstance.submit();
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a[download][href="/downloads/CV_Lucas_Figueroa.pdf"]',
    );
    expect(button?.textContent).toContain('Descargar CV de Lucas');
    expect(button?.getAttribute('aria-label')).toBe('Descargar CV de Lucas');
    expect(button?.getAttribute('download')).toBe('CV_Lucas_Figueroa.pdf');
  });

  it('reveals streamed text progressively and flushes the validated answer on completion', async () => {
    const answer = 'Esta respuesta aparece progresivamente antes de terminar.';
    let finishStream: () => void = () => undefined;
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({
          request_id: 'r-typing',
          sequence: 1,
          type: 'start',
          protocol_version: '5',
          content_version: 'v1',
        });
        onEvent({ request_id: 'r-typing', sequence: 2, type: 'text-delta', text: answer });
        await new Promise<void>((resolve) => {
          finishStream = resolve;
        });
        onEvent({
          request_id: 'r-typing',
          sequence: 3,
          type: 'part',
          part: { type: 'text', grounding: 'general', text: answer },
        });
        onEvent({
          request_id: 'r-typing',
          sequence: 4,
          type: 'done',
          protocol_version: '5',
          content_version: 'v1',
        });
      },
    };
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    let fixture: ComponentFixture<ChatPage> | undefined;
    let responsePromise: Promise<void> | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    try {
      await TestBed.configureTestingModule({
        imports: [ChatPage],
        providers: [{ provide: ChatClient, useValue: client }],
      }).compileComponents();
      fixture = TestBed.createComponent(ChatPage);
      await waitForCompatibility(fixture);
      fixture.componentInstance.message = 'Consulta';

      responsePromise = fixture.componentInstance.submit();
      fixture.detectChanges();
      for (let frame = 0; frame < 20; frame += 1) {
        const scheduled = [...frames.values()];
        frames.clear();
        scheduled.forEach((callback) => callback((frame + 1) * 16.7));
        fixture.detectChanges();
      }

      const page = fixture.nativeElement as HTMLElement;
      const preview = page.querySelector<HTMLElement>('[data-testid="streaming-assistant-text"]');
      const visibleText = preview?.querySelector('.chat-streaming-text')?.textContent ?? '';
      expect(preview?.getAttribute('aria-live')).toBe('off');
      expect(visibleText.length).toBeGreaterThan(0);
      expect(visibleText.length).toBeLessThan(answer.length);

      finishStream();
      await responsePromise;
      fixture.detectChanges();

      expect(page.querySelector('[data-testid="streaming-assistant-text"]')).toBeNull();
      expect(page.querySelector('[aria-label="Respuesta general"]')?.textContent).toContain(answer);
    } finally {
      finishStream();
      fixture?.destroy();
      vi.unstubAllGlobals();
    }
  });

  it('renders safe activity and groups server-owned citations with a grounded answer', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
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
    await waitForCompatibility(fixture);
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
      checkCompatibility: async () => 'compatible',
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
    await waitForCompatibility(fixture);
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
    const client = { checkCompatibility: async () => 'compatible', stream: async () => undefined };
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
      checkCompatibility: async () => 'compatible',
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
    await waitForCompatibility(fixture);
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
      checkCompatibility: async () => 'compatible',
      stream: async () => {
        throw new ChatStreamError('stream-closed', true);
      },
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
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
    const client = {
      checkCompatibility: async () => 'incompatible',
      stream: async () => undefined,
    };
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
    const client = { checkCompatibility: async () => 'compatible', stream: async () => undefined };
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
    const client = { checkCompatibility: async () => 'compatible', stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    let returnCount = 0;
    fixture.componentInstance.returnToIntro.subscribe(() => {
      returnCount += 1;
    });
    await waitForCompatibility(fixture);

    const action = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="reset-journey"]',
    )!;
    action.click();

    expect(action.type).toBe('button');
    expect(action.closest('[data-testid="chat-composer"]')).not.toBeNull();
    expect(returnCount).toBe(1);
  });

  it('submits a valid composer message when Enter is pressed', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: vi.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
    fixture.componentInstance.message = 'Send this message';

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    (fixture.nativeElement as HTMLElement).querySelector('textarea')!.dispatchEvent(event);
    await fixture.whenStable();

    expect(event.defaultPrevented).toBe(true);
    expect(client.stream).toHaveBeenCalledWith(
      'Send this message',
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('preserves Shift+Enter and IME composition as textarea input', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: vi.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
    fixture.componentInstance.message = 'Keep editing';
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;

    const shiftEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      cancelable: true,
    });
    textarea.dispatchEvent(shiftEnter);
    const composingEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      cancelable: true,
    });
    textarea.dispatchEvent(composingEnter);
    const keyCode229 = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    Object.defineProperty(keyCode229, 'keyCode', { value: 229 });
    textarea.dispatchEvent(keyCode229);

    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(keyCode229.defaultPrevented).toBe(false);
    expect(client.stream).not.toHaveBeenCalled();
  });

  it('keeps a natural-height conversation with a bounded transcript scroller', async () => {
    const client = { checkCompatibility: async () => 'compatible', stream: async () => undefined };
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
      checkCompatibility: async () => 'compatible',
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
    await waitForCompatibility(fixture);
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

  it('prefills a starter during compatibility checks without sending it', async () => {
    const client = {
      checkCompatibility: () => new Promise<'compatible'>(() => undefined),
      stream: vi.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const starter = page.querySelector<HTMLButtonElement>('[data-testid="compatibility-starter"]');
    starter?.click();
    fixture.detectChanges();

    expect(starter?.getAttribute('aria-label')).toBe(
      'Elegir pregunta: ¿Qué proyectos puedo explorar?',
    );
    expect(fixture.componentInstance.message).toBe('¿Qué proyectos puedo explorar?');
    expect(fixture.componentInstance.compatibilityPending()).toBe(true);
    expect(client.stream).not.toHaveBeenCalled();
    expect(page.querySelectorAll('[data-testid="compatibility-starter"]')).toHaveLength(0);
    expect(
      page.querySelector('[data-testid="selected-compatibility-starter"]')?.textContent,
    ).toContain('cuando el chat conecte');
    fixture.destroy();
  });

  it('sends the selected starter through the normal submit flow once compatible', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: vi.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);

    const starter = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="chat-starter"]',
    );
    starter?.click();

    expect(client.stream).toHaveBeenCalledWith(
      '¿Qué proyectos puedo explorar?',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    fixture.destroy();
  });

  it('hides starter prompts as soon as the first conversation starts', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: vi.fn(() => new Promise<void>(() => undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('[data-testid="chat-starters"]')).not.toBeNull();
    page.querySelector<HTMLButtonElement>('[data-testid="chat-starter"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.state().status).toBe('streaming');
    expect(page.querySelector('[data-testid="chat-starters"]')).toBeNull();
    expect(page.querySelector('[data-testid="active-user-message"]')?.textContent).toContain(
      '¿Qué proyectos puedo explorar?',
    );
    fixture.destroy();
  });

  it('renders accessible desktop side guides and hides duplicate central starters at 2xl', async () => {
    const client = { checkCompatibility: async () => 'compatible', stream: async () => undefined };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
    const page = fixture.nativeElement as HTMLElement;
    const starters = page.querySelector<HTMLElement>('[data-testid="chat-side-starters"]');
    const guide = page.querySelector<HTMLElement>('[data-testid="chat-usage-guide"]');

    expect(starters?.tagName).toBe('ASIDE');
    expect(starters?.getAttribute('aria-labelledby')).toBe('chat-side-starters-heading');
    expect(starters?.querySelectorAll('[data-testid="chat-side-starter"]')).toHaveLength(4);
    expect(starters?.classList.contains('2xl:block')).toBe(true);
    expect(starters?.classList.contains('2xl:col-start-1')).toBe(true);
    expect(starters?.classList.contains('2xl:row-start-2')).toBe(true);
    expect(
      page.querySelector('[data-testid="chat-starters"]')?.classList.contains('2xl:hidden'),
    ).toBe(true);
    expect(guide?.tagName).toBe('ASIDE');
    expect(guide?.getAttribute('aria-labelledby')).toBe('chat-usage-guide-heading');
    expect(guide?.querySelectorAll('ol > li')).toHaveLength(3);
    expect(guide?.classList.contains('2xl:col-start-3')).toBe(true);
    expect(guide?.classList.contains('2xl:row-start-2')).toBe(true);
    expect(
      page
        .querySelector('[data-testid="chat-viewport"] > div')
        ?.classList.contains('2xl:max-w-[88rem]'),
    ).toBe(true);
    expect(guide?.textContent).toContain('Cómo usar el asistente');
    expect(guide?.textContent).toContain('vas a ver los archivos y las páginas consultadas');
    fixture.destroy();
  });

  it('sends a desktop starter through the normal chat flow and keeps the guide after answering', async () => {
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: vi.fn(async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({
          request_id: 'side-starter-1',
          sequence: 1,
          type: 'start',
          protocol_version: '5',
          content_version: 'v1',
        });
        onEvent({
          request_id: 'side-starter-1',
          sequence: 2,
          type: 'part',
          part: { type: 'text', grounding: 'general', text: 'Podemos recorrer los proyectos.' },
        });
        onEvent({
          request_id: 'side-starter-1',
          sequence: 3,
          type: 'done',
          protocol_version: '5',
          content_version: 'v1',
        });
      }),
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
    const page = fixture.nativeElement as HTMLElement;
    const starter = page.querySelector<HTMLButtonElement>('[data-testid="chat-side-starter"]')!;

    starter.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(starter.getAttribute('aria-label')).toBe(
      'Elegir pregunta: ¿Qué proyectos puedo explorar?',
    );
    expect(client.stream).toHaveBeenCalledTimes(1);
    expect(client.stream).toHaveBeenCalledWith(
      '¿Qué proyectos puedo explorar?',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(fixture.componentInstance.state().status).toBe('complete');
    expect(page.querySelector('[data-testid="chat-usage-guide"]')).not.toBeNull();
    fixture.destroy();
  });

  it('disables desktop starter controls while streaming and ignores a second selection', async () => {
    let requestSignal: AbortSignal | undefined;
    const client = {
      checkCompatibility: async () => 'compatible',
      stream: vi.fn(
        async (_message: string, _onEvent: (event: ChatEvent) => void, signal: AbortSignal) => {
          requestSignal = signal;
          await new Promise<void>(() => undefined);
        },
      ),
    };
    await TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [{ provide: ChatClient, useValue: client }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    await waitForCompatibility(fixture);
    const page = fixture.nativeElement as HTMLElement;
    const starters = page.querySelectorAll<HTMLButtonElement>(
      '[data-testid="chat-side-starter"]',
    );

    starters[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.state().status).toBe('streaming');
    expect(starters[0].disabled).toBe(true);
    expect(starters[1].disabled).toBe(true);

    starters[1].click();
    fixture.componentInstance.selectStarter(fixture.componentInstance.starterPrompts[1]);

    expect(client.stream).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);
    fixture.destroy();
  });
});
