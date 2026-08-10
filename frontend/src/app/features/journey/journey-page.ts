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

import { HlmButtonImports } from '@spartan-ng/helm/button';

import { ValidatedContentBundle } from '../../core/content/content-validator';
import { ChatPage } from '../chat/chat-page';
import { ProjectCard } from '../../shared/project-card/project-card';
import { RecordCard } from '../../shared/record-card/record-card';

@Component({
  selector: 'app-journey-page',
  imports: [ChatPage, ProjectCard, RecordCard, HlmButtonImports],
  styleUrl: './journey-page.css',
  template: `
    <main id="main-content" class="mx-auto w-[min(100%_-_2rem,_72rem)] sm:w-[min(100%_-_4rem,_72rem)]">
      <nav class="sr-only sm:not-sr-only sm:fixed sm:top-1/2 sm:right-8 sm:z-10 sm:-translate-y-1/2" aria-label="Progreso del recorrido" data-testid="journey-progress">
        <ol class="grid gap-3">
          @for (step of journeySteps; track step.id; let index = $index) {
            <li>
              <a
                class="block size-2.5 rounded-full border border-primary bg-background transition-[background-color,transform] duration-200 ease-out hover:scale-110 focus-visible:scale-110"
                [class.bg-primary]="progress() >= index"
                [class.scale-110]="progress() >= index"
                [attr.data-step]="step.id"
                [attr.href]="'#' + step.id"
                [attr.aria-label]="'Ir a ' + step.label"
                [attr.aria-current]="progress() === index ? 'step' : null"
              ></a>
            </li>
          }
        </ol>
      </nav>
      <section id="intro" class="h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="journey-title">
        <div class="grid min-h-full content-center py-8 sm:py-12">
          <div class="max-w-2xl">
            <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">Portfolio de Lucas Figueroa</p>
            <h1 id="journey-title" tabindex="-1" class="mt-3 max-w-[11ch] font-[var(--font-display)] text-5xl font-semibold leading-none tracking-[-0.05em] text-[var(--color-ink)] sm:text-7xl">Un recorrido claro, sin atajos.</h1>
            <div class="mt-5 max-w-xl" data-testid="profile-summary">
              @for (claim of profileRecord?.claims; track claim.claim_id) {
                <p class="m-0 text-lg leading-relaxed text-[var(--color-text)] sm:text-xl">{{ claim.text }}</p>
              }
            </div>
            <button hlmBtn class="mt-7 min-h-11" data-testid="continue-intro" type="button" (click)="advance(1)">Continuar</button>
          </div>
        </div>
      </section>

      <section id="experience" class="h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="experience-title">
        <div class="grid min-h-full content-center gap-8 py-8 sm:py-12">
          <div class="max-w-3xl">
          <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">Trayectoria</p>
          <h2 id="experience-title" tabindex="-1" class="mt-3 font-[var(--font-display)] text-4xl font-semibold leading-none tracking-[-0.05em] text-[var(--color-ink)] sm:text-6xl">
            Experiencia, formaci&oacute;n y especialidades
          </h2>
        </div>
        <div class="grid gap-4" data-testid="experience-timeline">
          @for (record of experienceRecords; track record.id) {
            <app-record-card [record]="record" eyebrow="Experiencia actual" />
          }
        </div>
        <div class="grid gap-8 md:grid-cols-3">
          <div class="grid gap-3">
            <h3 class="m-0 text-sm font-bold uppercase tracking-[0.08em] text-[var(--color-heading)]">Formaci&oacute;n</h3>
            <div class="grid gap-3" data-testid="education-list">
              @for (record of educationRecords; track record.id) {
                <app-record-card [record]="record" eyebrow="UTN" [headingLevel]="4" />
              }
            </div>
          </div>
          <div class="grid gap-3">
            <h3 class="m-0 text-sm font-bold uppercase tracking-[0.08em] text-[var(--color-heading)]">Especialidades</h3>
            <div class="grid gap-3" data-testid="skills-list">
              @for (record of skillRecords; track record.id) {
                <app-record-card [record]="record" eyebrow="Stack" [headingLevel]="4" />
              }
            </div>
          </div>
          <div class="grid gap-3">
            <h3 class="m-0 text-sm font-bold uppercase tracking-[0.08em] text-[var(--color-heading)]">Certificaciones</h3>
            <div class="grid gap-3" data-testid="certifications-list">
              @for (record of certificationRecords; track record.id) {
                <app-record-card [record]="record" eyebrow="Certificaci&oacute;n" [headingLevel]="4" />
              }
            </div>
          </div>
        </div>
          @if (progress() >= 1) {
            <button hlmBtn class="min-h-11 w-fit" data-testid="continue-experience" type="button" (click)="advance(2)">
              Ver proyectos
            </button>
          }
        </div>
      </section>

      <section id="projects" class="h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="projects-title">
        <div class="grid min-h-full content-center gap-8 py-8 sm:py-12">
          <div class="max-w-3xl">
          <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">Evidencia</p>
          <h2 id="projects-title" tabindex="-1" class="mt-3 font-[var(--font-display)] text-4xl font-semibold leading-none tracking-[-0.05em] text-[var(--color-ink)] sm:text-6xl">Proyectos en producci&oacute;n</h2>
        </div>
        <div class="grid gap-4 md:grid-cols-3">
          @for (record of projectRecords; track record.id) {
            <app-project-card [record]="record" />
          }
        </div>
          @if (progress() >= 2) {
            <button hlmBtn class="min-h-11 w-fit" data-testid="continue-projects" type="button" (click)="advance(3)">
              Continuar
            </button>
          }
        </div>
      </section>

      <section id="assistant" #journeyStep class="h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="assistant-title">
        <div class="grid min-h-full content-center py-8 sm:py-12">
          <div class="max-w-2xl border-y border-border p-6 opacity-0 translate-y-4 transition-[opacity,transform] duration-300 ease-out sm:ml-auto sm:p-12 motion-reduce:translate-y-0 motion-reduce:transition-none" [class.opacity-100]="isVisible()" [class.translate-y-0]="isVisible()">
            <h2 id="assistant-title" tabindex="-1" class="m-0 font-[var(--font-display)] text-4xl font-semibold leading-none tracking-[-0.05em] text-[var(--color-ink)] sm:text-6xl">Asistente</h2>
        @if (assistantUnlocked()) {
          <button hlmBtn variant="outline" class="mt-5 min-h-11" data-testid="return-assistant" type="button" (click)="navigateToAssistant()">
            Volver al asistente
          </button>
          <app-chat-page [focusOnEntry]="true" />
        } @else if (progress() >= 3) {
          <p>Completaste el recorrido. Ya pod&eacute;s abrir el chat.</p>
          <button hlmBtn class="mt-5 min-h-11" data-testid="unlock-assistant" type="button" (click)="unlockAssistant()">
            Abrir el chat
          </button>
        } @else {
          <p class="mt-5 max-w-xl text-lg leading-relaxed text-[var(--color-text)]">
            Recorr&eacute; las secciones anteriores para habilitar el chat.
          </p>
          <button
            hlmBtn
            variant="outline"
            class="mt-5 min-h-11"
            data-testid="return-intro"
            type="button"
            (click)="focusFragment('intro')"
          >
            Volver al inicio
          </button>
          }
          </div>
        </div>
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
  readonly journeySteps = [
    { id: 'intro', label: 'Introducci\u00f3n' },
    { id: 'experience', label: 'Trayectoria' },
    { id: 'projects', label: 'Proyectos' },
    { id: 'assistant', label: 'Asistente' },
  ] as const;
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
    this.scrollTo(document.getElementById('assistant'));
    this.chatPage()?.focusEntry();
  }

  focusFragment(fragment: string, retainReadingOrder = false): void {
    const section = document.getElementById(fragment);
    const heading = section?.querySelector<HTMLElement>('h1, h2');
    this.scrollTo(section);
    if (!retainReadingOrder) heading?.focus({ preventScroll: true });
  }

  private scrollTo(section: Element | null): void {
    section?.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
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
