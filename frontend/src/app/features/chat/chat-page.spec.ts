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
        onEvent({ request_id: 'r-1', sequence: 1, type: 'start', content_version: 'v1' });
        onEvent({
          request_id: 'r-1',
          sequence: 2,
          type: 'part',
          part: {
            type: 'text',
            text: 'Respuesta respaldada.',
            record_ids: ['p1'],
            claim_ids: ['c1'],
          },
        });
        onEvent({ request_id: 'r-1', sequence: 3, type: 'done', content_version: 'v1' });
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
    expect(page.querySelector('[aria-label="Respuesta respaldada"]')?.textContent).toContain(
      'Respuesta respaldada.',
    );
    expect(page.querySelector('label[for="chat-message"]')?.textContent).toContain('Tu consulta');
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

    expect(page.querySelector('section')?.classList.contains('w-[min(100%_-_2rem,_52rem)]')).toBe(
      true,
    );
    expect(page.querySelector('section')?.classList.contains('sm:w-[min(100%_-_4rem,_52rem)]')).toBe(
      true,
    );
    expect(page.querySelector('textarea')?.classList.contains('min-h-28')).toBe(true);
    expect(page.querySelector('button[type="submit"]')?.classList.contains('min-h-11')).toBe(true);
  });
});
