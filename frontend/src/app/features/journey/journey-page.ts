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
      <div
        class="journey-ribbon"
        aria-hidden="true"
        data-testid="journey-ribbon"
        [style.--ribbon-progress]="renderedRibbonProgress()"
      >
        <svg viewBox="0 0 100 100" focusable="false" role="presentation" preserveAspectRatio="xMidYMid slice">
          <defs>
            <filter id="journey-ribbon-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="0.55" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <g class="journey-ribbon__lines" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#journey-ribbon-glow)">
            @for (path of ribbonPaths(); track $index) {
              <path [attr.d]="path" />
            }
          </g>
        </svg>
      </div>
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
      <section id="intro" #introStep class="journey-section h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="journey-title">
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

      <section id="experience" #experienceStep class="journey-section h-svh overflow-hidden scroll-mt-0" aria-labelledby="experience-title">
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

      <section id="projects" class="journey-section h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="projects-title">
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

      <section id="assistant" #journeyStep class="journey-section h-svh overflow-y-auto overscroll-contain scroll-mt-0" aria-labelledby="assistant-title">
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
          @if (progress() === 3) {
            <button
              hlmBtn
              variant="outline"
              class="mt-4 min-h-11"
              data-testid="reset-journey"
              type="button"
              (click)="resetJourney()"
            >
              Reiniciar recorrido
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
  /** Drives the decorative SVG between its compact line state and open ribbon state. */
  readonly ribbonProgress = signal(0);
  readonly renderedRibbonProgress = signal(0);
  readonly ribbonPaths = signal(this.buildRibbonPaths(0, 0));
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
  private readonly introStep = viewChild.required<ElementRef<HTMLElement>>('introStep');
  private readonly chatPage = viewChild(ChatPage);
  private observer: IntersectionObserver | undefined;
  private fragmentSubscription: Subscription | undefined;
  private initialFragmentNavigation = true;
  private sectionScrollContainers: HTMLElement[] = [];
  private navigationIntent: { destinationId: string; targetProgress: number } | undefined;
  private ribbonAnimationFrame: number | undefined;
  private lastRibbonFrame = 0;
  private readonly onWindowScroll = () => this.updateRibbonProgressFromScroll();
  private readonly onSectionScroll = (event: Event) => {
    const section = event.currentTarget as HTMLElement;
    this.updateRibbonProgressFromSection(section);
  };

  advance(nextStep: 1 | 2 | 3): void {
    if (nextStep !== this.progress() + 1) return;
    this.progress.set(nextStep);
    const nextSection = ['experience', 'projects', 'assistant'][nextStep - 1];
    if (nextSection) {
      this.beginRibbonNavigation(nextSection, nextStep / (this.journeySteps.length - 1));
      queueMicrotask(() => this.focusFragment(nextSection));
    }
  }

  unlockAssistant(): void {
    if (this.progress() !== 3) return;
    this.assistantUnlocked.set(true);
    queueMicrotask(() => this.navigateToAssistant());
  }

  resetJourney(): void {
    if (this.progress() !== 3) return;
    this.assistantUnlocked.set(false);
    this.progress.set(0);
    this.beginRibbonNavigation('intro', 0);
    queueMicrotask(() => this.focusFragment('intro'));
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
    window.addEventListener('scroll', this.onWindowScroll, { passive: true });
    this.sectionScrollContainers = Array.from(
      this.introStep().nativeElement.parentElement?.querySelectorAll<HTMLElement>('.journey-section') ?? [],
    );
    this.sectionScrollContainers.forEach((section) =>
      section.addEventListener('scroll', this.onSectionScroll, { passive: true }),
    );
    this.updateRibbonProgressFromScroll();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.renderRibbonProgress(0.58, 0);
    } else {
      this.ribbonAnimationFrame = requestAnimationFrame((time) => this.animateRibbon(time));
    }
    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (fragment) {
        const retainReadingOrder = this.initialFragmentNavigation;
        queueMicrotask(() => this.focusFragment(fragment, retainReadingOrder));
      }
      this.initialFragmentNavigation = false;
    });
    const IntersectionObserverConstructor = window.IntersectionObserver;
    if (typeof IntersectionObserverConstructor !== 'function') {
      this.isVisible.set(true);
      this.experienceVisible.set(true);
      return;
    }
    this.observer = new IntersectionObserverConstructor((entries) => {
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
    window.removeEventListener('scroll', this.onWindowScroll);
    if (this.ribbonAnimationFrame !== undefined) cancelAnimationFrame(this.ribbonAnimationFrame);
    this.sectionScrollContainers.forEach((section) =>
      section.removeEventListener('scroll', this.onSectionScroll),
    );
    this.observer?.disconnect();
    this.fragmentSubscription?.unsubscribe();
  }

  private updateRibbonProgressFromScroll(): void {
    const activeSection = this.sectionScrollContainers.reduce<HTMLElement | undefined>(
      (closest, section) =>
        !closest ||
        Math.abs(section.getBoundingClientRect().top) < Math.abs(closest.getBoundingClientRect().top)
          ? section
          : closest,
      undefined,
    );
    if (activeSection) this.updateRibbonProgressFromSection(activeSection);
  }

  private updateRibbonProgressFromSection(section: HTMLElement): void {
    const index = this.sectionScrollContainers.indexOf(section);
    if (index < 0) return;

    if (this.navigationIntent) {
      if (section.id !== this.navigationIntent.destinationId) return;
      this.navigationIntent = undefined;
    }

    const scrollableDistance = Math.max(0, section.scrollHeight - section.clientHeight);
    const sectionProgress = scrollableDistance ? section.scrollTop / scrollableDistance : 0;
    const value = (index + Math.min(1, Math.max(0, sectionProgress))) / (this.journeySteps.length - 1);
    this.setRibbonProgress(Math.min(1, value));
  }

  private beginRibbonNavigation(destinationId: string, targetProgress: number): void {
    this.navigationIntent = { destinationId, targetProgress };
    this.setRibbonProgress(targetProgress);
  }

  private setRibbonProgress(value: number): void {
    const target = Math.min(1, Math.max(0, value));
    this.ribbonProgress.set(target);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.renderRibbonProgress(0.58, 0);
    }
  }

  private animateRibbon(time: number): void {
    const elapsed = this.lastRibbonFrame ? time - this.lastRibbonFrame : 0;
    this.lastRibbonFrame = time;
    const current = this.renderedRibbonProgress();
    const target = this.ribbonProgress();
    const smoothing = Math.min(0.08, Math.max(0.018, elapsed / 700));
    const next = Math.abs(target - current) < 0.002 ? target : current + (target - current) * smoothing;
    this.renderRibbonProgress(next, time / 2300);
    this.ribbonAnimationFrame = requestAnimationFrame((nextTime) => this.animateRibbon(nextTime));
  }

  private renderRibbonProgress(progress: number, phase: number): void {
    this.renderedRibbonProgress.set(progress);
    this.ribbonPaths.set(this.buildRibbonPaths(progress, phase));
  }

  private buildRibbonPaths(progress: number, phase: number): string[] {
    const route = this.buildRibbonRoute(phase);
    const head = this.getRibbonHeadIndex(progress, route.anchors);
    const stageDistance = Math.abs(progress * 3 - Math.round(progress * 3));
    const settledExpansion = 1 - Math.min(1, stageDistance / 0.34);
    const visiblePointCount = Math.round(188 - settledExpansion * 76);
    const tail = Math.max(0, Math.floor(head) - visiblePointCount);
    const spine = route.points.slice(tail, Math.floor(head) + 1);
    return Array.from({ length: 11 }, (_, thread) => this.offsetRibbonThread(spine, thread, progress));
  }

  private buildRibbonRoute(phase: number): { points: Array<[number, number]>; anchors: number[] } {
    const stages = [
      { center: [82, 49], radius: [15, 8], figure: 'compact' },
      { center: [50, 86], radius: [60, 43], figure: 'low-swell' },
      { center: [50, 57], radius: [60, 35], figure: 'diagonal-sweep' },
      { center: [55, 55], radius: [58, 34], figure: 'lateral-fold' },
    ] as const;
    const points: Array<[number, number]> = [];
    const anchors: number[] = [];
    for (let stage = 0; stage < stages.length; stage += 1) {
      const loop = this.buildRibbonLoop(stages[stage], phase + stage * 0.16);
      if (stage) {
        const from = points.at(-1)!;
        const beforeFrom = points.at(-2)!;
        const fromTangent: [number, number] = [from[0] - beforeFrom[0], from[1] - beforeFrom[1]];
        const toTangent: [number, number] = [loop[1][0] - loop[0][0], loop[1][1] - loop[0][1]];
        points.push(...this.buildRibbonConnector(from, loop[0], fromTangent, toTangent, phase));
      }
      points.push(...loop);
      anchors.push(points.length - 1);
    }
    return { points, anchors };
  }

  private buildRibbonLoop(
    stage: {
      center: readonly [number, number];
      radius: readonly [number, number];
      figure: 'compact' | 'low-swell' | 'diagonal-sweep' | 'lateral-fold';
    },
    phase: number,
  ): Array<[number, number]> {
    return Array.from({ length: 112 }, (_, index) => {
      const t = index / 111;
      const angle = Math.PI * 2 * t;
      const breathing = 1 + 0.035 * Math.sin(phase * 0.72);
      const { center, radius } = stage;
      let x: number;
      let y: number;
      if (stage.figure === 'low-swell') {
        x = center[0] + radius[0] - radius[0] * 2 * t;
        y =
          center[1] -
          breathing * radius[1] * 0.72 * Math.sin(Math.PI * t) +
          3.2 * Math.sin(angle + phase * 0.14);
      } else if (stage.figure === 'diagonal-sweep') {
        x = center[0] - radius[0] + radius[0] * 2 * t;
        y =
          center[1] +
          radius[1] * (1 - 2 * t) +
          breathing * 7.5 * Math.sin(angle + phase * 0.12);
      } else if (stage.figure === 'lateral-fold') {
        x = center[0] + radius[0] - radius[0] * 2 * t + 22 * Math.sin(Math.PI * t);
        y =
          center[1] -
          radius[1] +
          radius[1] * 2 * t +
          breathing * 7 * Math.sin(angle * 1.1 + phase * 0.1);
      } else {
        x = center[0] - radius[0] + radius[0] * 2 * t;
        y = center[1] + 0.75 * Math.sin(angle + phase * 0.22);
      }
      return [x, y];
    });
  }

  private buildRibbonConnector(
    from: [number, number],
    to: [number, number],
    fromTangent: [number, number],
    toTangent: [number, number],
    phase: number,
  ): Array<[number, number]> {
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const handleLength = Math.min(42, Math.max(14, distance * 0.34));
    const normalize = ([x, y]: [number, number]): [number, number] => {
      const length = Math.max(0.001, Math.hypot(x, y));
      return [x / length, y / length];
    };
    const fromDirection = normalize(fromTangent);
    const toDirection = normalize(toTangent);
    const controlFrom: [number, number] = [
      from[0] + fromDirection[0] * handleLength,
      from[1] + fromDirection[1] * handleLength,
    ];
    const controlTo: [number, number] = [
      to[0] - toDirection[0] * handleLength,
      to[1] - toDirection[1] * handleLength,
    ];
    const chordLength = Math.max(0.001, distance);
    const chordNormal: [number, number] = [-(to[1] - from[1]) / chordLength, (to[0] - from[0]) / chordLength];

    return Array.from({ length: 94 }, (_, index) => {
      const t = (index + 1) / 95;
      const inverse = 1 - t;
      const bow = Math.sin(Math.PI * t) ** 2 * (1.5 + 0.5 * Math.sin(phase));
      return [
        inverse ** 3 * from[0] +
          3 * inverse ** 2 * t * controlFrom[0] +
          3 * inverse * t ** 2 * controlTo[0] +
          t ** 3 * to[0] +
          chordNormal[0] * bow,
        inverse ** 3 * from[1] +
          3 * inverse ** 2 * t * controlFrom[1] +
          3 * inverse * t ** 2 * controlTo[1] +
          t ** 3 * to[1] +
          chordNormal[1] * bow,
      ];
    });
  }

  private getRibbonHeadIndex(progress: number, anchors: number[]): number {
    const stageProgress = progress * (anchors.length - 1);
    const stage = Math.min(anchors.length - 2, Math.floor(stageProgress));
    const local = stageProgress - stage;
    return anchors[stage] + (anchors[stage + 1] - anchors[stage]) * local;
  }

  private offsetRibbonThread(points: Array<[number, number]>, thread: number, progress: number): string {
    const stageDistance = Math.abs(progress * 3 - Math.round(progress * 3));
    const settledExpansion = 1 - Math.min(1, stageDistance / 0.34);
    const shifted = points.map(([x, y], index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const length = Math.max(0.001, Math.hypot(next[0] - previous[0], next[1] - previous[1]));
      const alongTrail = index / Math.max(1, points.length - 1);
      const fan = 0.28 + 0.72 * Math.sin(Math.PI * alongTrail);
      const stage = Math.min(3, Math.round(progress * 3));
      const settledHalfSpread = [4.5, 9.5, 11, 10][stage];
      const travelingHalfSpread = 3.25;
      const halfSpread = travelingHalfSpread + settledExpansion * (settledHalfSpread - travelingHalfSpread) * fan;
      const normalizedThread = (thread - 5) / 5;
      const offset = normalizedThread * halfSpread;
      return `${(x - ((next[1] - previous[1]) / length) * offset).toFixed(2)} ${(y + ((next[0] - previous[0]) / length) * offset).toFixed(2)}`;
    });
    return `M ${shifted.join(' L ')}`;
  }
}
