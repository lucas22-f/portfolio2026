import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';

import { PortfolioRecord } from '../../core/content/content-validator';

@Component({
  selector: 'app-project-card',
  imports: [HlmBadgeImports, HlmCardImports, HlmSeparatorImports],
  template: `
    <article hlmCard class="h-full border-t-4 border-t-primary bg-card text-card-foreground">
      <header hlmCardHeader>
        <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-primary">Proyecto</p>
        <h3 hlmCardTitle class="font-[var(--font-display)] text-2xl tracking-[-0.03em] text-[var(--color-heading)] sm:text-3xl">
          {{ record().title }}
        </h3>
      </header>

      <div hlmCardContent class="grid gap-5">
        <p class="m-0 leading-relaxed text-muted-foreground">{{ record().project?.summary }}</p>
        <div data-testid="project-evidence" class="grid gap-3">
          <div hlmSeparator></div>
          <p class="m-0 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Datos revisados
          </p>
          <ul class="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="project-tech" aria-label="Tecnologias">
            @for (tag of record().tags; track tag) {
              <li hlmBadge variant="outline">{{ tag }}</li>
            }
          </ul>
        </div>
      </div>

      @if (record().project?.links; as links) {
        <footer hlmCardFooter class="flex flex-wrap gap-3">
          <nav class="flex flex-wrap gap-3" aria-label="Enlaces del proyecto">
            @for (link of links; track link.url) {
              <a class="min-h-11 text-primary underline underline-offset-4 hover:text-primary/80" [href]="link.url" rel="noreferrer">{{ link.label }}</a>
            }
          </nav>
        </footer>
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCard {
  readonly record = input.required<PortfolioRecord>();
}
