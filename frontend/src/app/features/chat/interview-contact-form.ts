import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ChatClient } from './chat-client';
import {
  ContactDraft,
  ContactField,
  ContactFormState,
  InterviewContactFormPart,
  createIdempotencyKey,
  emptyContactDraft,
  validateContactDraft,
} from './contact-form';

@Component({
  selector: 'app-interview-contact-form',
  imports: [
    FormsModule,
    HlmAlertImports,
    HlmButtonImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    HlmTextareaImports,
  ],
  template: `
    <section
      class="contact-card"
      [attr.data-state]="state()"
      aria-label="Contacto para entrevistas"
    >
      @if (state() === 'closed') {
        <div class="contact-suggestion">
          <div>
            <p class="eyebrow">Contacto directo</p>
            <h4>¿Querés conversar sobre una oportunidad?</h4>
            <p>Podés enviarle a Lucas un mensaje privado sin salir del chat.</p>
          </div>
          <div class="actions">
            <button hlmBtn class="min-h-11" type="button" (click)="open()">Abrir formulario</button
            ><button hlmBtn class="min-h-11" variant="ghost" type="button" (click)="decline()">
              Ahora no
            </button>
          </div>
          @if (dirty()) {
            <div class="draft-actions" role="status">
              <span>Tenés un borrador guardado.</span
              ><button hlmBtn class="min-h-11" variant="outline" type="button" (click)="open()">
                Continuar editando</button
              ><button hlmBtn class="min-h-11" variant="ghost" type="button" (click)="discard()">
                Descartar borrador
              </button>
            </div>
          }
        </div>
      } @else if (state() === 'success' || state() === 'duplicate') {
        <div hlmAlert class="status-card" role="status" tabindex="-1" #statusHeading>
          <h4 hlmAlertTitle>
            {{ state() === 'success' ? 'Mensaje enviado' : 'Mensaje ya recibido' }}
          </h4>
          <p hlmAlertDescription>Lucas recibió tu solicitud y podrá responderte por correo.</p>
        </div>
      } @else {
        <form class="contact-form" (ngSubmit)="submit()" novalidate>
          <div>
            <p class="eyebrow">Contacto directo</p>
            <h4 #formHeading tabindex="-1">Enviar una consulta a Lucas</h4>
            <p>Completá los datos esenciales. El formulario no se agrega a la conversación.</p>
          </div>
          <div hlmFieldGroup class="fields">
            <div hlmField>
              <label hlmFieldLabel for="contact-name">Nombre</label
              ><input
                hlmInput
                id="contact-name"
                name="name"
                autocomplete="name"
                [(ngModel)]="draft.name"
                [attr.aria-invalid]="!!errors().name"
                [attr.aria-describedby]="errors().name ? 'contact-name-error' : null"
                [disabled]="state() === 'submitting'"
                required
                maxlength="80"
              />
              @if (errors().name) {
                <p hlmFieldError id="contact-name-error">{{ errors().name }}</p>
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="contact-email">Correo electrónico</label
              ><input
                hlmInput
                id="contact-email"
                name="email"
                type="email"
                autocomplete="email"
                [(ngModel)]="draft.email"
                [attr.aria-invalid]="!!errors().email"
                [attr.aria-describedby]="errors().email ? 'contact-email-error' : null"
                [disabled]="state() === 'submitting'"
                required
                maxlength="254"
              />
              @if (errors().email) {
                <p hlmFieldError id="contact-email-error">{{ errors().email }}</p>
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="contact-company"
                >Empresa <span class="optional">(opcional)</span></label
              ><input
                hlmInput
                id="contact-company"
                name="company"
                autocomplete="organization"
                [(ngModel)]="draft.company"
                [attr.aria-invalid]="!!errors().company"
                [attr.aria-describedby]="errors().company ? 'contact-company-error' : null"
                [disabled]="state() === 'submitting'"
                maxlength="120"
              />
              @if (errors().company) {
                <p hlmFieldError id="contact-company-error">{{ errors().company }}</p>
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="contact-message">Mensaje</label
              ><textarea
                hlmTextarea
                id="contact-message"
                name="message"
                rows="5"
                [(ngModel)]="draft.message"
                [attr.aria-invalid]="!!errors().message"
                [attr.aria-describedby]="
                  errors().message ? 'contact-message-error contact-consent' : 'contact-consent'
                "
                [disabled]="state() === 'submitting'"
                required
                maxlength="2000"
              ></textarea>
              @if (errors().message) {
                <p hlmFieldError id="contact-message-error">{{ errors().message }}</p>
              }
            </div>
          </div>
          <p id="contact-consent" class="consent">
            Al enviar, autorizás que estos datos se entreguen a Lucas para responder tu consulta.
          </p>
          @if (message()) {
            <div
              hlmAlert
              [variant]="state() === 'validation-error' ? 'destructive' : 'default'"
              [attr.role]="
                state() === 'validation-error' || state() === 'unavailable' ? 'alert' : 'status'
              "
            >
              <p hlmAlertDescription>{{ message() }}</p>
            </div>
          }
          <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement() }}</p>
          <div class="actions">
            <button hlmBtn class="min-h-11" type="submit" [disabled]="state() === 'submitting'">
              @if (state() === 'submitting') {
                <hlm-spinner aria-hidden="true" /> Enviando…
              } @else {
                Enviar mensaje
              }</button
            ><button
              hlmBtn
              class="min-h-11"
              variant="outline"
              type="button"
              (click)="close()"
              [disabled]="state() === 'submitting'"
            >
              Cerrar
            </button>
          </div>
        </form>
      }
    </section>
  `,
  styleUrl: './interview-contact-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InterviewContactFormComponent {
  readonly part = input.required<InterviewContactFormPart>();
  private readonly client = inject(ChatClient);
  private readonly formHeading = viewChild<ElementRef<HTMLElement>>('formHeading');
  private readonly statusHeading = viewChild<ElementRef<HTMLElement>>('statusHeading');
  readonly state = signal<ContactFormState>('closed');
  readonly errors = signal<Partial<Record<ContactField, string>>>({});
  readonly message = signal('');
  readonly announcement = signal('');
  draft: ContactDraft = emptyContactDraft();
  private idempotencyKey?: string;

  dirty(): boolean {
    return Object.values(this.draft).some((value) => value.trim());
  }
  open(): void {
    this.state.set('editing');
    this.message.set('');
    queueMicrotask(() => this.formHeading()?.nativeElement.focus());
  }
  decline(): void {
    this.state.set('closed');
    this.announcement.set('Sugerencia de contacto descartada.');
  }
  close(): void {
    this.state.set('closed');
    this.announcement.set(this.dirty() ? 'Borrador guardado localmente.' : 'Formulario cerrado.');
  }
  discard(): void {
    this.draft = emptyContactDraft();
    this.errors.set({});
    this.idempotencyKey = undefined;
    this.announcement.set('Borrador descartado.');
  }

  async submit(): Promise<void> {
    if (this.state() === 'submitting') return;
    const errors = validateContactDraft(this.draft);
    this.errors.set(errors);
    const first = Object.keys(errors)[0] as ContactField | undefined;
    if (first) {
      this.state.set('validation-error');
      this.message.set('Revisá los campos marcados.');
      queueMicrotask(() => document.getElementById(`contact-${first}`)?.focus());
      return;
    }
    this.state.set('submitting');
    this.message.set('');
    this.announcement.set('Enviando mensaje.');
    this.idempotencyKey ??= createIdempotencyKey();
    try {
      const result = await this.client.submitContact(this.draft, this.idempotencyKey);
      this.errors.set(result.field_errors ?? {});
      if (result.outcome === 'accepted') this.state.set('success');
      else if (result.outcome === 'duplicate_accepted' || result.outcome === 'duplicate_processing')
        this.state.set('duplicate');
      else if (result.outcome === 'validation_error') {
        this.state.set('validation-error');
        this.message.set('Revisá los datos antes de volver a enviar.');
      } else if (result.outcome === 'delivery_retryable' || result.outcome === 'throttled') {
        this.state.set('retryable-failure');
        this.message.set('No se pudo completar el envío. Podés intentar nuevamente.');
      } else if (result.outcome === 'delivery_uncertain') {
        this.state.set('uncertain');
        this.message.set('No pudimos confirmar la entrega. No vuelvas a enviarlo automáticamente.');
      } else {
        this.state.set('unavailable');
        this.message.set('El contacto no está disponible en este momento.');
      }
      this.announcement.set(this.message() || 'Solicitud completada.');
      if (this.state() === 'success' || this.state() === 'duplicate')
        setTimeout(() => this.statusHeading()?.nativeElement.focus());
    } catch {
      this.state.set('retryable-failure');
      this.message.set(
        'No se pudo conectar. Conservamos el borrador para que intentes nuevamente.',
      );
      this.announcement.set(this.message());
    }
  }
}
