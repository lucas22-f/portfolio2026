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
    <section class="mx-auto w-[min(100%_-_2rem,_52rem)] py-14 sm:w-[min(100%_-_4rem,_52rem)] sm:py-24" aria-labelledby="chat-heading">
      <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">Consulta guiada</p>
      <h3 #heading data-testid="chat-heading" tabindex="-1" class="mt-3 font-[var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--color-ink)] sm:text-6xl">Chat informativo</h3>
      <p class="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Preguntá sobre experiencia, formación, habilidades y proyectos publicados.
      </p>

      <form class="mt-10 grid gap-3" (ngSubmit)="submit()">
        <label class="font-bold text-[var(--color-heading)]" for="chat-message">Tu consulta</label>
        <textarea
          id="chat-message"
          name="message"
          class="min-h-28 w-full rounded-md border border-input bg-card p-3 text-[var(--color-text)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          [(ngModel)]="message"
          [disabled]="state().status === 'streaming' || compatible() === false"
          [attr.disabled]="compatible() === false ? '' : null"
          rows="3"
          required
        ></textarea>
        <button hlmBtn class="min-h-11 w-fit"
          type="submit"
          [disabled]="!message.trim() || state().status === 'streaming' || compatible() === false"
        >
          {{ state().status === 'streaming' ? 'Consultando…' : 'Enviar consulta' }}
        </button>
      </form>

      <p class="sr-only" aria-live="polite" aria-atomic="true">{{ state().announcement }}</p>
      @if (compatible() === false) {
        <section class="mt-6 border-l-4 border-primary bg-card p-4" role="alert">
          <p>El chat no está disponible temporalmente.</p>
        </section>
      } @else if (state().status === 'error' || state().status === 'refused') {
        <section class="mt-6 border-l-4 border-primary bg-card p-4" [attr.role]="state().status === 'error' ? 'alert' : 'status'">
          <p>{{ state().announcement }}</p>
          @if (state().retryable) {
            <button hlmBtn class="mt-3 min-h-11" type="button" (click)="retry()">Reintentar</button>
          }
        </section>
      }

      @if (state().model || state().usage) {
        <p class="chat-metadata" aria-live="polite">
          Modelo: {{ state().model }}
          @if (state().usage?.total_tokens !== undefined) {
            ? Uso: {{ state().usage?.total_tokens }} tokens
          }
        </p>
      }

      <section class="mt-6 grid gap-4" aria-label="Respuesta respaldada">
        @for (part of state().parts; track $index) {
          @switch (part.type) {
            @case ('text') {
              <p>{{ part.text }}</p>
            }
            @case ('source') {
              <p class="m-0 text-sm text-muted-foreground">Fuente: {{ part.label }}</p>
            }
            @case ('project-card') {
              <article class="border-t-4 border-primary bg-card p-5">
                <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">Proyecto</p>
                <h4 class="mt-2 font-[var(--font-display)] text-2xl text-[var(--color-heading)]">{{ part.title }}</h4>
                <p class="leading-relaxed text-[var(--color-text)]">{{ part.summary }}</p>
                @for (link of part.links; track link.url) {
                  <a class="mr-4 inline-flex min-h-11 items-center text-primary underline underline-offset-4 hover:text-primary/80" [href]="link.url" rel="noreferrer">{{ link.label }}</a>
                }
              </article>
            }
          }
        }
      </section>
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
