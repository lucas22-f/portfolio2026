import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ChatClient,
  ChatState,
  ChatStreamError,
  createChatState,
  applyChatEvent,
} from './chat-client';

@Component({
  selector: 'app-chat-page',
  imports: [FormsModule],
  template: `
    <main id="main-content" class="chat-page">
      <p class="chat-page__eyebrow">Consulta guiada</p>
      <h1 #heading data-testid="chat-heading" tabindex="-1">Chat informativo</h1>
      <p class="chat-page__intro">
        Preguntá sobre experiencia, formación, habilidades y proyectos publicados.
      </p>

      <form class="chat-composer" (ngSubmit)="submit()">
        <label for="chat-message">Tu consulta</label>
        <textarea
          id="chat-message"
          name="message"
          [(ngModel)]="message"
          [disabled]="state().status === 'streaming' || compatible() === false"
          [attr.disabled]="compatible() === false ? '' : null"
          rows="3"
          required
        ></textarea>
        <button
          type="submit"
          [disabled]="!message.trim() || state().status === 'streaming' || compatible() === false"
        >
          {{ state().status === 'streaming' ? 'Consultando…' : 'Enviar consulta' }}
        </button>
      </form>

      <p class="sr-only" aria-live="polite" aria-atomic="true">{{ state().announcement }}</p>
      @if (compatible() === false) {
        <section class="chat-status" role="alert">
          <p>El chat no est? disponible temporalmente.</p>
        </section>
      } @else if (state().status === 'error' || state().status === 'refused') {
        <section class="chat-status" [attr.role]="state().status === 'error' ? 'alert' : 'status'">
          <p>{{ state().announcement }}</p>
          @if (state().retryable) {
            <button type="button" (click)="retry()">Reintentar</button>
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

      <section class="chat-response" aria-label="Respuesta respaldada">
        @for (part of state().parts; track $index) {
          @switch (part.type) {
            @case ('text') {
              <p>{{ part.text }}</p>
            }
            @case ('source') {
              <p class="chat-source">Fuente: {{ part.label }}</p>
            }
            @case ('project-card') {
              <article class="chat-project-card">
                <p>Proyecto</p>
                <h2>{{ part.title }}</h2>
                <p>{{ part.summary }}</p>
                @for (link of part.links; track link.url) {
                  <a [href]="link.url" rel="noreferrer">{{ link.label }}</a>
                }
              </article>
            }
          }
        }
      </section>
    </main>
  `,
  styleUrl: './chat-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPage implements AfterViewInit {
  private readonly client = inject(ChatClient);
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  readonly state = signal<ChatState>(createChatState());
  readonly compatible = signal<boolean | undefined>(undefined);
  message = '';
  private lastMessage = '';

  ngAfterViewInit(): void {
    this.heading().nativeElement.focus();
    void this.loadCompatibility();
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
