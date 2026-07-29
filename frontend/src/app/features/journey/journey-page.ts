import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import { ValidatedContentBundle } from '../../core/content/content-validator';
import { ChatPage } from '../chat/chat-page';
import { ProjectCard } from '../../shared/project-card/project-card';
import { RecordCard } from '../../shared/record-card/record-card';

@Component({
  selector: 'app-journey-page',
  imports: [ChatPage, ProjectCard, RecordCard],
  styleUrl: './journey-page.css',
  template: `
    <div
      class="journey"
      [attr.role]="assistantUnlocked() ? null : 'main'"
      [attr.id]="assistantUnlocked() ? null : 'main-content'"
      [attr.tabindex]="assistantUnlocked() ? null : -1"
    >
      <section id="intro" class="journey__intro" aria-labelledby="journey-title">
        <p class="journey__eyebrow">Portfolio de Lucas Figueroa</p>
        <h1 id="journey-title" tabindex="-1">Un recorrido claro, sin atajos.</h1>
        <p class="journey__lead">Conocé la experiencia, la evidencia y los proyectos antes del chat.</p>
        <button data-testid="continue-intro" type="button" (click)="advance(1)">Continuar</button>
      </section>

      <section id="experience" aria-labelledby="experience-title">
        <h2 id="experience-title" tabindex="-1">Experiencia y formación</h2>
        @for (record of experienceRecords; track record.id) {
          <app-record-card [record]="record" eyebrow="Trayectoria" />
        }
        @if (progress() >= 1) {
          <button data-testid="continue-experience" type="button" (click)="advance(2)">Continuar</button>
        }
      </section>

      <section id="projects" aria-labelledby="projects-title">
        <h2 id="projects-title" tabindex="-1">Proyectos</h2>
        @for (record of projectRecords; track record.id) {
          <app-project-card [record]="record" />
        }
        @if (progress() >= 2) {
          <button data-testid="continue-projects" type="button" (click)="advance(3)">Continuar</button>
        }
      </section>

      <section id="assistant" #journeyStep class="journey__step" [class.is-visible]="isVisible()">
        <h2 id="assistant-title" tabindex="-1">Asistente</h2>
        @if (assistantUnlocked()) {
          <button data-testid="return-assistant" type="button" (click)="focusFragment('assistant')">
            Volver al asistente
          </button>
          <app-chat-page />
        } @else if (progress() >= 3) {
          <p>Completaste el recorrido. Ya podés abrir el chat.</p>
          <button data-testid="unlock-assistant" type="button" (click)="unlockAssistant()">Abrir el chat</button>
        } @else {
          <p>Recorré las secciones anteriores para habilitar el chat.</p>
        }
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JourneyPage implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly content = this.route.snapshot.data['content'] as ValidatedContentBundle | undefined;
  readonly progress = signal(0);
  readonly isVisible = signal(false);
  readonly assistantUnlocked = signal(false);
  readonly experienceRecords = this.content?.portfolio.records.filter((record) => record.kind !== 'project') ?? [];
  readonly projectRecords = this.content?.portfolio.records.filter((record) => record.kind === 'project') ?? [];
  private readonly journeyStep = viewChild.required<ElementRef<HTMLElement>>('journeyStep');
  private observer: IntersectionObserver | undefined;
  private fragmentSubscription: Subscription | undefined;

  advance(nextStep: number): void {
    if (nextStep === this.progress() + 1) this.progress.set(nextStep);
  }

  unlockAssistant(): void {
    if (this.progress() === 3) this.assistantUnlocked.set(true);
  }

  focusFragment(fragment: string): void {
    const section = document.getElementById(fragment);
    const heading = section?.querySelector<HTMLElement>('h1, h2');
    section?.scrollIntoView?.();
    heading?.focus();
  }

  ngAfterViewInit(): void {
    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (fragment) queueMicrotask(() => this.focusFragment(fragment));
    });
    if (!('IntersectionObserver' in window)) {
      this.isVisible.set(true);
      return;
    }
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        this.isVisible.set(true);
        this.observer?.disconnect();
      }
    });
    this.observer.observe(this.journeyStep().nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.fragmentSubscription?.unsubscribe();
  }
}
