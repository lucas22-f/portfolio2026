import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HlmButtonImports } from '@spartan-ng/helm/button';

import {
  ChatClient,
  ChatState,
  ChatStreamError,
  createChatState,
  applyChatEvent,
} from './chat-client';

@Component({
  selector: 'app-chat-page',
  imports: [FormsModule, HlmButtonImports],
  template: `
    <section data-testid="chat-viewport" class="h-svh overflow-hidden bg-[var(--color-bg)]" aria-labelledby="chat-heading">
      <div class="mx-auto grid h-full w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] px-4 sm:px-8">
        <header class="border-b border-border py-5 sm:py-6">
          <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">Consulta guiada</p>
          <h3 #heading data-testid="chat-heading" tabindex="-1" class="mt-2 font-[var(--font-display)] text-3xl font-semibold tracking-[-0.05em] text-[var(--color-ink)] sm:text-4xl">Chat informativo</h3>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">Preguntá sobre experiencia, formación, habilidades y proyectos publicados.</p>
        </header>

        <div data-testid="chat-transcript" class="min-h-0 overflow-y-auto overscroll-contain py-6 sm:py-8" role="log" aria-label="Respuesta del asistente" aria-live="polite" aria-relevant="additions text">
          <div class="mx-auto grid w-full max-w-3xl content-start gap-4">
            <p class="sr-only" aria-live="polite" aria-atomic="true">{{ state().announcement }}</p>
            @if (compatible() === false) {
              <section class="border-l-4 border-primary bg-card p-4" role="alert"><p class="m-0">El chat no está disponible temporalmente.</p></section>
            } @else if (state().status === 'error' || state().status === 'refused') {
              <section class="border-l-4 border-primary bg-card p-4" [attr.role]="state().status === 'error' ? 'alert' : 'status'">
                <p class="m-0">{{ state().announcement }}</p>
                @if (state().retryable) { <button hlmBtn class="mt-3 min-h-11" type="button" (click)="retry()">Reintentar</button> }
              </section>
            }
            @if (state().portfolioSearchUsed) {
              <p data-testid="portfolio-search-notice" class="border-l-4 border-primary bg-card p-3 text-sm text-[var(--color-text)]" role="status">Información consultada en el portfolio.</p>
            }
            @if (state().status === 'streaming') {
              <p class="m-0 w-fit rounded-full bg-[var(--color-accent-subtle)] px-3 py-1 text-sm text-[var(--color-heading)]" role="status">El asistente está respondiendo…</p>
            }
            @if (!state().parts.length && state().status === 'idle' && compatible() !== false) {
              <p class="m-0 max-w-xl text-lg leading-relaxed text-muted-foreground">Escribí una consulta para iniciar la conversación.</p>
            }
            @for (part of state().parts; track $index) {
              @switch (part.type) {
                @case ('text') {
                  <article class="grid gap-2 rounded-lg border border-border bg-card p-4 sm:p-5" [attr.aria-label]="part.grounding === 'general' ? 'Respuesta general' : 'Respuesta basada en el portfolio'">
                    <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">{{ part.grounding === 'general' ? 'Respuesta general' : 'Basada en el portfolio' }}</p>
                    <p class="m-0 leading-relaxed">{{ part.text }}</p>
                  </article>
                }
                @case ('source') { <p class="m-0 text-sm text-muted-foreground">Fuente: {{ part.label }}</p> }
                @case ('project-card') {
                  <article class="border-t-4 border-primary bg-card p-5">
                    <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">Proyecto</p>
                    <h4 class="mt-2 font-[var(--font-display)] text-2xl text-[var(--color-heading)]">{{ part.title }}</h4>
                    <p class="leading-relaxed text-[var(--color-text)]">{{ part.summary }}</p>
                    @for (link of part.links; track link.url) { <a class="mr-4 inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:text-primary/80" [href]="link.url" rel="noreferrer">{{ link.label }}</a> }
                  </article>
                }
              }
            }
            @if (state().model || state().usage) {
              <p class="m-0 text-xs text-muted-foreground" aria-live="polite">Modelo: {{ state().model }} @if (state().usage?.total_tokens !== undefined) { · Uso: {{ state().usage?.total_tokens }} tokens }</p>
            }
          </div>
        </div>

        <form data-testid="chat-composer" class="border-t border-border bg-[var(--color-bg)] py-4 sm:py-5" (ngSubmit)="submit()">
          <div class="mx-auto grid w-full max-w-3xl gap-3 rounded-xl border border-input bg-card p-3 shadow-sm">
            <label class="sr-only" for="chat-message">Tu consulta</label>
            <textarea id="chat-message" name="message" class="min-h-24 w-full resize-none bg-transparent px-1 text-[var(--color-text)] outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50" placeholder="Escribí tu consulta…" [(ngModel)]="message" [disabled]="state().status === 'streaming' || compatible() === false" [attr.disabled]="compatible() === false ? '' : null" rows="3" required></textarea>
            <div class="flex items-center justify-between gap-3"><p class="m-0 text-xs text-muted-foreground">Usá el botón para enviar.</p><button hlmBtn class="min-h-11 shrink-0" type="submit" [disabled]="!message.trim() || state().status === 'streaming' || compatible() === false">{{ state().status === 'streaming' ? 'Consultando…' : 'Enviar consulta' }}</button></div>
          </div>
        </form>
      </div>
    </section>
  `,
  styleUrl: './chat-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPage implements AfterViewInit {
  @Input() focusOnEntry = false;
  private readonly client = inject(ChatClient);
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  readonly state = signal<ChatState>(createChatState());
  readonly compatible = signal<boolean | undefined>(undefined);
  message = '';
  private lastMessage = '';

  ngAfterViewInit(): void {
    if (this.focusOnEntry) this.focusEntry();
    void this.loadCompatibility();
  }

  focusEntry(): void {
    this.heading().nativeElement.focus();
  }

  private async loadCompatibility(): Promise<void> {
    this.compatible.set(await this.client.checkCompatibility());
  }

  async submit(): Promise<void> {
    this.lastMessage = this.message.trim();
    if (!this.lastMessage || this.compatible() === false) return;
    this.state.set({
      ...createChatState(),
      status: 'streaming',
      announcement: 'Enviando consulta.',
    });
    try {
      await this.client.stream(this.lastMessage, (event) =>
        this.state.update((current) => applyChatEvent(current, event)),
      );
    } catch (error) {
      const streamError =
        error instanceof ChatStreamError ||
        (typeof error === 'object' && error !== null && 'code' in error && 'retryable' in error);
      const invalidOutput = streamError && error.code === 'invalid-provider-output';
      const incompatible = streamError && error.code === 'content-incompatible';
      if (incompatible) {
        this.compatible.set(false);
        return;
      }
      this.state.update((current) => ({
        ...current,
        status: 'error',
        announcement: invalidOutput
          ? 'No pude validar la respuesta.'
          : 'No pude completar la respuesta. Intentá nuevamente.',
        retryable: streamError && typeof error.retryable === 'boolean' ? error.retryable : true,
      }));
    }
  }

  retry(): Promise<void> {
    this.message = this.lastMessage;
    return this.submit();
  }
}
