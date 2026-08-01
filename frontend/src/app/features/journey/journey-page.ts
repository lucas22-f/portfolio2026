import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import { HlmProgressImports } from '@spartan-ng/helm/progress';

import { ValidatedContentBundle } from '../../core/content/content-validator';
import { ChatPage } from '../chat/chat-page';
import { ProjectCard } from '../../shared/project-card/project-card';
import { RecordCard } from '../../shared/record-card/record-card';

@Component({
  selector: 'app-journey-page',
  imports: [ChatPage, ProjectCard, RecordCard, HlmProgressImports],
  styleUrl: './journey-page.css',
  template: `
    <main id="main-content" class="journey">
      <div
        hlmProgress
        [value]="progressPercent()"
        [max]="100"
        [getValueLabel]="getProgressValueLabel"
        data-testid="journey-progress"
        aria-label="Progreso del recorrido"
      >
        <div hlmProgressIndicator></div>
      </div>
      <section id="intro" class="journey__intro" aria-labelledby="journey-title">
        <p class="journey__eyebrow">Portfolio de Lucas Figueroa</p>
        <h1 id="journey-title" tabindex="-1">Un recorrido claro, sin atajos.</h1>
        <div class="journey__profile" data-testid="profile-summary">
          @for (claim of profileRecord?.claims; track claim.claim_id) {
            <p class="journey__lead">{{ claim.text }}</p>
          }
        </div>
        <button data-testid="continue-intro" type="button" (click)="advance(1)">Continuar</button>
      </section>

      <section id="experience" class="journey__experience" aria-labelledby="experience-title">
        <div class="journey__section-heading">
          <p class="journey__eyebrow">Trayectoria</p>
          <h2 id="experience-title" tabindex="-1">
            Experiencia, formaci&oacute;n y especialidades
          </h2>
        </div>
        <div class="journey__timeline" data-testid="experience-timeline">
          @for (record of experienceRecords; track record.id) {
            <app-record-card [record]="record" eyebrow="Experiencia actual" />
          }
        </div>
        <div class="journey__fact-groups">
          <div class="journey__fact-group">
            <h3>Formaci&oacute;n</h3>
            <div class="journey__compact-list" data-testid="education-list">
              @for (record of educationRecords; track record.id) {
                <app-record-card [record]="record" eyebrow="UTN" />
              }
            </div>
          </div>
          <div class="journey__fact-group">
            <h3>Especialidades</h3>
            <div class="journey__compact-list" data-testid="skills-list">
              @for (record of skillRecords; track record.id) {
                <app-record-card [record]="record" eyebrow="Stack" />
              }
            </div>
          </div>
          <div class="journey__fact-group">
            <h3>Certificaciones</h3>
            <div class="journey__compact-list" data-testid="certifications-list">
              @for (record of certificationRecords; track record.id) {
                <app-record-card [record]="record" eyebrow="Certificaci&oacute;n" />
              }
            </div>
          </div>
        </div>
        @if (progress() >= 1) {
          <button data-testid="continue-experience" type="button" (click)="advance(2)">
            Ver proyectos
          </button>
        }
      </section>

      <section id="projects" class="journey__projects" aria-labelledby="projects-title">
        <div class="journey__section-heading">
          <p class="journey__eyebrow">Evidencia</p>
          <h2 id="projects-title" tabindex="-1">Proyectos en producci&oacute;n</h2>
        </div>
        <div class="journey__project-grid">
          @for (record of projectRecords; track record.id) {
            <app-project-card [record]="record" />
          }
        </div>
        @if (progress() >= 2) {
          <button data-testid="continue-projects" type="button" (click)="advance(3)">
            Continuar
          </button>
        }
      </section>

      <section id="assistant" #journeyStep class="journey__step" [class.is-visible]="isVisible()">
        <h2 id="assistant-title" tabindex="-1">Asistente</h2>
        @if (assistantUnlocked()) {
          <button data-testid="return-assistant" type="button" (click)="navigateToAssistant()">
            Volver al asistente
          </button>
          <app-chat-page [focusOnEntry]="true" />
        } @else if (progress() >= 3) {
          <p>Completaste el recorrido. Ya pod&eacute;s abrir el chat.</p>
          <button data-testid="unlock-assistant" type="button" (click)="unlockAssistant()">
            Abrir el chat
          </button>
        } @else {
          <p>Recorr&eacute; las secciones anteriores para habilitar el chat.</p>
        }
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JourneyPage implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly content = this.route.snapshot.data['content'] as
    ValidatedContentBundle | undefined;
    readonly progress = signal<0 | 1 | 2 | 3>(0);
  readonly progressPercent = computed(() => (this.assistantUnlocked() ? 100 : this.progress() * 25));
  readonly progressLabel = computed(() => {
    const labels = [
      'Introducción: 0% completado',
      'Trayectoria: 25% completado',
      'Proyectos: 50% completado',
      'Asistente listo: 75% completado',
      'Asistente desbloqueado: 100% completado',
    ];
    return labels[this.assistantUnlocked() ? 4 : this.progress()];
  });
  readonly getProgressValueLabel = () => this.progressLabel();
  readonly isVisible = signal(false);
  readonly assistantUnlocked = signal(false);
  readonly profileRecord = this.content?.portfolio.records.find(
    (record) => record.kind === 'profile',
  );
  readonly experienceRecords =
    this.content?.portfolio.records.filter((record) => record.kind === 'experience') ?? [];
  readonly educationRecords =
    this.content?.portfolio.records.filter(
      (record) => record.kind === 'education' && !record.tags.includes('certification'),
    ) ?? [];
  readonly skillRecords =
    this.content?.portfolio.records.filter((record) => record.kind === 'skill') ?? [];
  readonly certificationRecords =
    this.content?.portfolio.records.filter((record) => record.tags.includes('certification')) ?? [];
  readonly projectRecords =
    this.content?.portfolio.records.filter((record) => record.kind === 'project') ?? [];
  private readonly journeyStep = viewChild.required<ElementRef<HTMLElement>>('journeyStep');
  private readonly chatPage = viewChild(ChatPage);
  private observer: IntersectionObserver | undefined;
  private fragmentSubscription: Subscription | undefined;
  private initialFragmentNavigation = true;

  advance(nextStep: 1 | 2 | 3): void {
    if (nextStep !== this.progress() + 1) return;
    this.progress.set(nextStep);
    const nextSection = ['experience', 'projects', 'assistant'][nextStep - 1];
    if (nextSection) queueMicrotask(() => this.focusFragment(nextSection));
  }

  unlockAssistant(): void {
    if (this.progress() !== 3) return;
    this.assistantUnlocked.set(true);
    queueMicrotask(() => this.navigateToAssistant());
  }

  navigateToAssistant(): void {
    document.getElementById('assistant')?.scrollIntoView?.();
    this.chatPage()?.focusEntry();
  }

  focusFragment(fragment: string, retainReadingOrder = false): void {
    const section = document.getElementById(fragment);
    const heading = section?.querySelector<HTMLElement>('h1, h2');
    section?.scrollIntoView?.();
    if (!retainReadingOrder) heading?.focus();
  }

  ngAfterViewInit(): void {
    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (fragment) {
        const retainReadingOrder = this.initialFragmentNavigation;
        queueMicrotask(() => this.focusFragment(fragment, retainReadingOrder));
      }
      this.initialFragmentNavigation = false;
    });
    if (typeof IntersectionObserver !== 'function') {
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
