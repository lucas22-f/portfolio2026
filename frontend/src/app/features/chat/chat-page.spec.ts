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
    expect(fixture.nativeElement.querySelector('[data-testid="chat-heading"]')?.tagName).toBe(
      'H3',
    );
  });

  it('announces a Spanish grounded response and renders only its text part', async () => {
    const client = {
      checkCompatibility: async () => true,
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({ request_id: 'r-1', sequence: 1, type: 'start', protocol_version: '2', content_version: 'v1' });
        onEvent({
          request_id: 'r-1',
          sequence: 2,
          type: 'part',
          part: {
            type: 'text',
            grounding: 'portfolio',
            text: 'Respuesta respaldada.',
            record_ids: ['p1'],
            claim_ids: ['c1'],
          },
        });
        onEvent({ request_id: 'r-1', sequence: 3, type: 'done', protocol_version: '2', content_version: 'v1' });
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

  it('renders a portfolio lookup notice when the search tool was invoked', async () => {
    const client = {
      checkCompatibility: async () => true,
      stream: async (_message: string, onEvent: (event: ChatEvent) => void) => {
        onEvent({ request_id: 'r-1', sequence: 1, type: 'start', protocol_version: '2', content_version: 'v1' });
        onEvent({ request_id: 'r-1', sequence: 2, type: 'tool', tool: 'search_portfolio' });
        onEvent({ request_id: 'r-1', sequence: 3, type: 'done', protocol_version: '2', content_version: 'v1' });
      },
    };
    await TestBed.configureTestingModule({ imports: [ChatPage], providers: [{ provide: ChatClient, useValue: client }] }).compileComponents();
    const fixture = TestBed.createComponent(ChatPage);
    fixture.componentInstance.message = 'Consulta';

    await fixture.componentInstance.submit();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="portfolio-search-notice"]')?.textContent)
      .toContain('Información consultada en el portfolio');
  });

  it('keeps invalid provider output on the safe non-retryable validation path', async () => {
    const client = {
      checkCompatibility: async () => true,
      stream: async () => {
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

    expect(page.querySelector('section')?.classList.contains('h-svh')).toBe(true);
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
    fixture.componentInstance.returnToIntro.subscribe(() => { returnCount += 1; });
    fixture.detectChanges();

    const action = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="reset-journey"]',
    )!;
    action.click();

    expect(action.type).toBe('button');
    expect(action.closest('[data-testid="chat-composer"]')).not.toBeNull();
    expect(returnCount).toBe(1);
  });

  it('keeps the assistant as a viewport-bound layout with an internal transcript scroller', async () => {
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
    expect(page.querySelector('[data-testid="chat-viewport"]')?.classList.contains('h-svh')).toBe(
      true,
    );
    expect(page.querySelector('[data-testid="chat-transcript"]')?.classList.contains('overflow-y-auto')).toBe(
      true,
    );
  });
});
