import {
  AfterViewInit,
  OnDestroy,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HlmButtonImports } from '@spartan-ng/helm/button';

import {
  ChatClient,
  ChatState,
  ChatStreamError,
  SourcePart,
  createChatState,
  applyChatEvent,
} from './chat-client';
import { InterviewContactFormComponent } from './interview-contact-form';

type ChatTurn = { message: string; state: ChatState };

@Component({
  selector: 'app-chat-page',
  imports: [FormsModule, HlmButtonImports, InterviewContactFormComponent],
  template: `
    <section
      data-testid="chat-viewport"
      class="min-h-svh bg-[var(--color-bg)]"
      aria-labelledby="chat-heading"
    >
      <div class="mx-auto grid w-full max-w-4xl px-4 sm:px-8">
        <header class="border-b border-border py-5 sm:py-6">
          <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">
            Consulta guiada
          </p>
          <h3
            #heading
            data-testid="chat-heading"
            tabindex="-1"
            class="mt-2 font-[var(--font-display)] text-3xl font-semibold tracking-[-0.05em] text-[var(--color-ink)] sm:text-4xl"
          >
            Chat informativo
          </h3>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Preguntá sobre experiencia, formación, habilidades y proyectos publicados.
          </p>
        </header>

        <div
          #transcript
          data-testid="chat-transcript"
          class="chat-transcript max-h-[58svh] overflow-y-auto overscroll-contain py-6 sm:py-8"
          role="log"
          aria-label="Respuesta del asistente"
          aria-live="polite"
          aria-relevant="additions text"
          (scroll)="onTranscriptScroll()"
        >
          <div class="mx-auto grid w-full max-w-3xl content-start gap-4">
            <p class="sr-only" aria-live="polite" aria-atomic="true">{{ state().announcement }}</p>
            @for (turn of completedTurns(); track turn.message + $index) {
              <article
                class="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-accent-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--color-heading)] sm:text-base"
                aria-label="Tu mensaje"
              >
                {{ turn.message }}
              </article>
              @for (part of turn.state.parts; track $index) {
                @if (part.type === 'text') {
                  <article
                    class="grid gap-2 rounded-2xl rounded-bl-sm border border-border bg-card p-4 sm:p-5"
                    aria-label="Respuesta del asistente"
                  >
                    <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">
                      {{
                        part.grounding === 'general'
                          ? 'Respuesta general'
                          : 'Basada en el portfolio'
                      }}
                    </p>
                    <p class="m-0 leading-relaxed">{{ part.text }}</p>
                    @if (
                      part.grounding === 'portfolio' &&
                      sourcesFollowingParts(turn.state.parts, $index).length
                    ) {
                      <section class="mt-1 border-t border-border pt-3">
                        <h4 class="m-0 text-sm font-semibold text-[var(--color-heading)]">
                          Fuentes consultadas
                        </h4>
                        <ul class="mt-2 grid gap-1 pl-5 text-sm text-muted-foreground">
                          @for (
                            source of sourcesFollowingParts(turn.state.parts, $index);
                            track source.filename + source.page
                          ) {
                            <li>{{ source.filename }}, página {{ source.page }}</li>
                          }
                        </ul>
                      </section>
                    }
                  </article>
                } @else if (part.type === 'interview_contact_form') {
                  <app-interview-contact-form class="chat-contact-part" [part]="part" />
                }
              }
              @if (turn.state.status === 'error' || turn.state.status === 'refused') {
                <p class="m-0 text-sm text-muted-foreground">{{ turn.state.announcement }}</p>
              }
            }
            @if (activeMessage) {
              <article
                data-testid="active-user-message"
                class="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-accent-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--color-heading)] sm:text-base"
                aria-label="Tu mensaje"
              >
                {{ activeMessage }}
              </article>
            }
            @if (compatible() === false) {
              <section class="border-l-4 border-primary bg-card p-4" role="alert">
                <p class="m-0">El chat no está disponible temporalmente.</p>
              </section>
            } @else if (state().status === 'error' || state().status === 'refused') {
              <section
                class="border-l-4 border-primary bg-card p-4"
                [attr.role]="state().status === 'error' ? 'alert' : 'status'"
              >
                <p class="m-0">{{ state().announcement }}</p>
                @if (state().retryable) {
                  <button hlmBtn class="mt-3 min-h-11" type="button" (click)="retry()">
                    Reintentar
                  </button>
                }
              </section>
            }
            @if (activityLabel()) {
              <aside
                data-testid="assistant-activity"
                class="flex w-fit items-center gap-2 rounded-full bg-[var(--color-accent-subtle)] px-3 py-1.5 text-sm text-[var(--color-heading)]"
                role="status"
              >
                @if (state().status === 'streaming') {
                  <span class="chat-activity-dot" aria-hidden="true"></span>
                }
                <span>{{ activityLabel() }}</span>
              </aside>
            }
            @if (!state().parts.length && state().status === 'idle' && compatible() !== false) {
              <p class="m-0 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Escribí una consulta para iniciar la conversación.
              </p>
            }
            @if (state().streamedText) {
              <article
                data-testid="streaming-assistant-text"
                class="chat-streaming-bubble grid gap-2 rounded-2xl rounded-bl-sm border border-border bg-card p-4 sm:p-5"
                aria-label="Respuesta en progreso"
                aria-live="polite"
                aria-atomic="false"
              >
                <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">
                  Respuesta en progreso
                </p>
                <p class="chat-streaming-text m-0 leading-relaxed">
                  {{ state().streamedText
                  }}<span class="chat-stream-caret" aria-hidden="true"></span>
                </p>
              </article>
            }
            @for (part of state().parts; track $index) {
              @switch (part.type) {
                @case ('text') {
                  <article
                    class="grid gap-2 rounded-2xl rounded-bl-sm border border-border bg-card p-4 sm:p-5"
                    [attr.aria-label]="
                      part.grounding === 'general'
                        ? 'Respuesta general'
                        : 'Respuesta basada en el portfolio'
                    "
                  >
                    <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">
                      {{
                        part.grounding === 'general'
                          ? 'Respuesta general'
                          : 'Basada en el portfolio'
                      }}
                    </p>
                    <p class="m-0 leading-relaxed">{{ part.text }}</p>
                    @if (part.grounding === 'portfolio' && sourcesFollowing($index).length) {
                      <section
                        data-testid="chat-sources"
                        class="mt-1 border-t border-border pt-3"
                        [attr.aria-labelledby]="'chat-sources-heading-' + $index"
                      >
                        <h4
                          [id]="'chat-sources-heading-' + $index"
                          class="m-0 text-sm font-semibold text-[var(--color-heading)]"
                        >
                          Fuentes consultadas
                        </h4>
                        <ul class="mt-2 grid gap-1 pl-5 text-sm text-muted-foreground">
                          @for (
                            source of sourcesFollowing($index);
                            track source.filename + source.page
                          ) {
                            <li>{{ source.filename }}, página {{ source.page }}</li>
                          }
                        </ul>
                      </section>
                    }
                  </article>
                }
                @case ('source') {}
                @case ('interview_contact_form') {
                  @if (state().status === 'complete') {
                    <app-interview-contact-form class="chat-contact-part" [part]="part" />
                  }
                }
              }
            }
          </div>
        </div>

        <form
          data-testid="chat-composer"
          class="chat-composer sticky bottom-0 z-10 border-t border-border bg-[var(--color-bg)] py-4 sm:py-5"
          (ngSubmit)="submit()"
        >
          <div
            class="mx-auto grid w-full max-w-3xl gap-3 rounded-xl border border-input bg-card p-3 shadow-sm"
          >
            <label class="sr-only" for="chat-message">Tu consulta</label>
            <textarea
              id="chat-message"
              name="message"
              class="chat-composer-input min-h-24 w-full resize-none bg-transparent px-1 text-[var(--color-text)] outline-none placeholder:text-muted-foreground"
              placeholder="Escribí tu consulta…"
              [(ngModel)]="message"
              [disabled]="state().status === 'streaming' || compatible() === false"
              [attr.disabled]="compatible() === false ? '' : null"
              rows="3"
              required
            ></textarea>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="m-0 text-xs text-muted-foreground">Usá el botón para enviar.</p>
              <div class="flex items-center gap-2">
                <button
                  hlmBtn
                  variant="outline"
                  class="min-h-11 shrink-0"
                  data-testid="reset-journey"
                  type="button"
                  (click)="returnToIntro.emit()"
                >
                  Volver al inicio</button
                ><button
                  hlmBtn
                  class="min-h-11 shrink-0"
                  type="submit"
                  [disabled]="
                    !message.trim() || state().status === 'streaming' || compatible() === false
                  "
                >
                  {{ state().status === 'streaming' ? 'Consultando…' : 'Enviar consulta' }}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </section>
  `,
  styleUrl: './chat-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPage implements AfterViewInit, OnDestroy {
  @Input() focusOnEntry = false;
  readonly returnToIntro = output<void>();
  private readonly client = inject(ChatClient);
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly transcriptRef = viewChild<ElementRef<HTMLElement>>('transcript');
  readonly state = signal<ChatState>(createChatState());
  readonly completedTurns = signal<ChatTurn[]>([]);
  readonly compatible = signal<boolean | undefined>(undefined);
  message = '';
  activeMessage = '';
  private lastMessage = '';
  private activeRequest?: AbortController;
  private stickToBottom = true;

  activityLabel(): string | undefined {
    const current = this.state();
    if (current.status === 'streaming') {
      if (current.portfolioSearchUsed) return 'Consultando información del portfolio';
      if (current.streamedText || current.parts.length) return 'Generando respuesta';
      return 'Preparando respuesta';
    }
    if (current.status === 'complete') {
      return current.portfolioSearchUsed
        ? 'Respuesta completada con información del portfolio'
        : 'Respuesta completada';
    }
    return undefined;
  }

  sourcesFollowing(index: number): SourcePart[] {
    return this.sourcesFollowingParts(this.state().parts, index);
  }

  sourcesFollowingParts(parts: ChatState['parts'], index: number): SourcePart[] {
    const sources: SourcePart[] = [];
    for (const part of parts.slice(index + 1)) {
      if (part.type === 'text') break;
      if (part.type === 'source') sources.push(part);
    }
    return sources;
  }

  ngAfterViewInit(): void {
    if (this.focusOnEntry) this.focusEntry();
    void this.loadCompatibility();
  }

  ngOnDestroy(): void {
    this.activeRequest?.abort();
  }

  focusEntry(): void {
    this.heading().nativeElement.focus();
  }

  onTranscriptScroll(): void {
    const transcript = this.transcriptRef()?.nativeElement;
    if (!transcript) return;
    // Stickiness threshold keeps auto-scroll while streaming, but releases it
    // as soon as the reader scrolls up to re-read earlier turns.
    this.stickToBottom =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 96;
  }

  private scrollTranscriptToBottom(): void {
    const transcript = this.transcriptRef()?.nativeElement;
    if (!transcript || !this.stickToBottom) return;
    const frame = (callback: () => void): void => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => callback());
        return;
      }
      callback();
    };
    // No artificial delay: renders happen on arrival via signals; the frame
    // only coalesces DOM scroll writes after Angular flushes the view.
    frame(() => {
      transcript.scrollTop = transcript.scrollHeight;
    });
  }

  private async loadCompatibility(): Promise<void> {
    this.compatible.set(await this.client.checkCompatibility());
  }

  async submit(retrying = false): Promise<void> {
    this.activeRequest?.abort();
    const controller = new AbortController();
    this.activeRequest = controller;
    this.lastMessage = this.message.trim();
    if (!this.lastMessage || this.compatible() === false) return;
    if (!retrying && this.activeMessage) {
      this.completedTurns.update((turns) => [
        ...turns,
        { message: this.activeMessage, state: this.state() },
      ]);
    }
    this.activeMessage = this.lastMessage;
    this.message = '';
    this.stickToBottom = true;
    this.state.set({
      ...createChatState(),
      status: 'streaming',
      announcement: 'Enviando consulta.',
    });
    try {
      await this.client.stream(
        this.lastMessage,
        (event) => {
          // Progressive render: every text-delta updates the signal on arrival
          // (no buffering/delays) and the pending bubble appends it; final
          // parts atomically replace the preview inside applyChatEvent.
          this.state.update((current) => applyChatEvent(current, event));
          this.scrollTranscriptToBottom();
        },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        this.state.set(createChatState());
        return;
      }
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
        // A delta is only a transient provider preview.  Once the stream fails
        // outside a server-owned terminal event, remove it rather than leaving
        // unvalidated text beside the error state.
        streamedText: '',
        status: 'error',
        announcement: invalidOutput
          ? 'No pude validar la respuesta.'
          : 'No pude completar la respuesta. Intentá nuevamente.',
        retryable: streamError && typeof error.retryable === 'boolean' ? error.retryable : true,
      }));
      this.scrollTranscriptToBottom();
    }
  }

  retry(): Promise<void> {
    this.message = this.lastMessage;
    return this.submit(true);
  }
}
