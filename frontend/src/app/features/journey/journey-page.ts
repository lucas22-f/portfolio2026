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

import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCarouselImports } from '@spartan-ng/helm/carousel';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';

import { ValidatedContentBundle } from '../../core/content/content-validator';
import { ChatPage } from '../chat/chat-page';
import { ProjectCard } from '../../shared/project-card/project-card';

@Component({
  selector: 'app-journey-page',
  imports: [
    ChatPage,
    ProjectCard,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCarouselImports,
    HlmSeparatorImports,
  ],
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

      <section id="experience" #experienceStep class="h-svh overflow-hidden scroll-mt-0" aria-labelledby="experience-title">
        <div class="grid h-full content-center gap-3 py-4 sm:gap-6 sm:py-10">
          <div class="max-w-3xl">
            <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">Trayectoria</p>
            <h2 id="experience-title" tabindex="-1" class="mt-2 font-[var(--font-display)] text-3xl font-semibold leading-none tracking-[-0.05em] text-[var(--color-ink)] sm:mt-3 sm:text-6xl">
              Construir sistemas que llegan a producci&oacute;n.
            </h2>
          </div>

          <div data-testid="experience-timeline">
          @if (experienceRecords[0]; as experience) {
            <article
              hlmCard
              class="border-l-4 border-l-primary bg-card text-card-foreground opacity-0 translate-y-3 transition-[opacity,transform] duration-500 ease-out motion-reduce:translate-y-0 motion-reduce:transition-none"
              [class.opacity-100]="experienceVisible()"
              [class.translate-y-0]="experienceVisible()"
            >
              <header hlmCardHeader>
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">Experiencia actual</p>
                  <p class="m-0 text-sm text-muted-foreground">Jun. 2025 &mdash; actualidad</p>
                </div>
                <h3 hlmCardTitle class="font-[var(--font-display)] text-xl tracking-[-0.03em] text-[var(--color-ink)] sm:text-3xl">
                  {{ experience.title }}
                </h3>
              </header>

              <div hlmCardContent class="grid gap-3">
                <p class="m-0 text-xs leading-relaxed text-muted-foreground sm:text-base">
                  Desarrollo remoto de soluciones conversacionales para equipos de Mercado Libre en la regi&oacute;n.
                </p>
                <div hlmSeparator></div>
                <ul class="m-0 grid list-none gap-2 p-0 text-xs leading-relaxed text-[var(--color-text)] sm:grid-cols-3 sm:text-sm">
                  <li class="border-l border-border pl-3">Workflows de bots internos y automatizaci&oacute;n.</li>
                  <li class="border-l border-border pl-3">Code Actions con APIs de RRHH y SAP SuccessFactors.</li>
                  <li class="border-l border-border pl-3">Pipelines de datos e IA sobre Fury.</li>
                </ul>
                <ul class="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Tecnolog&iacute;as y &aacute;reas de experiencia">
                  @for (tag of experienceTags; track tag) {
                    <li hlmBadge variant="outline">{{ tag }}</li>
                  }
                </ul>
              </div>
            </article>
          }
          </div>

          <div class="grid gap-2 text-xs leading-relaxed text-muted-foreground sm:hidden">
            <p class="m-0" data-testid="education-list"><span class="font-semibold text-[var(--color-text)]">Formaci&oacute;n:</span> T&eacute;cnico Universitario en Programaci&oacute;n y Desarrollo Web Full Stack (MERN).</p>
            <p class="m-0" data-testid="certifications-list"><span class="font-semibold text-[var(--color-text)]">Credenciales:</span> 4 certificaciones en desarrollo web, prompting y automatizaci&oacute;n.</p>
          </div>

          <div class="hidden gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-start">
            <div class="grid gap-2" data-testid="education-list">
              <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Formaci&oacute;n</p>
              @for (record of educationRecords; track record.id) {
                <p class="m-0 text-sm leading-snug text-[var(--color-text)]">{{ record.title }}</p>
              }
            </div>
            <div class="grid gap-2">
              <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Especialidades</p>
              <ul class="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="skills-list" aria-label="Especialidades">
                @for (record of skillRecords; track record.id) {
                  <li hlmBadge variant="secondary">{{ record.title }}</li>
                }
              </ul>
            </div>
          </div>

          <div class="hidden gap-2 sm:grid" data-testid="certifications-list">
            <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Certificaciones</p>
            <ul class="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Certificaciones">
              @for (record of certificationRecords; track record.id) {
                <li hlmBadge variant="outline">{{ record.title }}</li>
              }
            </ul>
          </div>

          @if (progress() >= 1) {
            <button hlmBtn class="min-h-11 w-fit" data-testid="continue-experience" type="button" (click)="advance(2)">
              Ver proyectos
            </button>
          }
        </div>
      </section>

      <section id="projects" class="h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="projects-title">
        <div class="grid min-h-full content-center gap-6 py-8 sm:gap-8 sm:py-12">
          <div class="max-w-3xl">
          <p class="m-0 text-xs font-bold uppercase tracking-[0.14em] text-primary">Evidencia</p>
          <h2 id="projects-title" tabindex="-1" class="mt-3 font-[var(--font-display)] text-4xl font-semibold leading-none tracking-[-0.05em] text-[var(--color-ink)] sm:text-6xl">Proyectos en producci&oacute;n</h2>
        </div>
        <hlm-carousel
          #projectCarousel
          class="block w-full max-w-full overflow-hidden motion-safe:transition-opacity motion-safe:duration-500"
          [options]="projectCarouselOptions"
          aria-label="Proyectos destacados"
          data-testid="projects-carousel"
        >
          <div hlmCarouselContent>
            @for (record of projectRecords; track record.id) {
              <div hlmCarouselItem class="basis-full">
                <app-project-card [record]="record" />
              </div>
            }
          </div>

          <div class="mt-4 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2" aria-label="Controles del carrusel de proyectos">
              <button
                hlmBtn
                variant="outline"
                size="sm"
                type="button"
                aria-label="Proyecto anterior"
                data-testid="projects-previous"
                (click)="projectCarousel.scrollPrev()"
              >
                Anterior
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                type="button"
                aria-label="Proyecto siguiente"
                data-testid="projects-next"
                (click)="projectCarousel.scrollNext()"
              >
                Siguiente
              </button>
            </div>
            <hlm-carousel-slide-display label="Proyecto" slideClass="font-mono text-xs text-muted-foreground" data-testid="projects-position" />
          </div>
        </hlm-carousel>
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
  readonly experienceVisible = signal(false);
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
  readonly experienceTags = ['Botmaker', 'Node.js', 'Python', 'BigQuery', 'RAG', 'MCP', 'Fury'];
  readonly projectRecords =
    this.content?.portfolio.records.filter((record) => record.kind === 'project') ?? [];
  readonly projectCarouselOptions = {
    align: 'start' as const,
    containScroll: 'trimSnaps' as const,
    duration: 28,
  };
  private readonly journeyStep = viewChild.required<ElementRef<HTMLElement>>('journeyStep');
  private readonly experienceStep = viewChild.required<ElementRef<HTMLElement>>('experienceStep');
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
      this.experienceVisible.set(true);
      return;
    }
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target === this.journeyStep().nativeElement) this.isVisible.set(true);
        if (entry.target === this.experienceStep().nativeElement) this.experienceVisible.set(true);
      }
      if (this.isVisible() && this.experienceVisible()) this.observer?.disconnect();
    }, { threshold: 0.2 });
    this.observer.observe(this.journeyStep().nativeElement);
    this.observer.observe(this.experienceStep().nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.fragmentSubscription?.unsubscribe();
  }
}
