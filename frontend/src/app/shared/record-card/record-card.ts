import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { HlmCardImports } from '@spartan-ng/helm/card';

import { PortfolioRecord } from '../../core/content/content-validator';

@Component({
  selector: 'app-record-card',
  imports: [HlmCardImports],
  template: `
    <article hlmCard class="h-full border-border bg-card text-card-foreground">
      <header hlmCardHeader>
        <p class="m-0 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {{ eyebrow() }}
        </p>
        @if (headingLevel() === 4) {
          <h4 hlmCardTitle class="font-[var(--font-display)] text-xl tracking-[-0.025em] text-[var(--color-ink)] sm:text-2xl">
            {{ record().title }}
          </h4>
        } @else {
          <h3 hlmCardTitle class="font-[var(--font-display)] text-xl tracking-[-0.025em] text-[var(--color-ink)] sm:text-2xl">
            {{ record().title }}
          </h3>
        }
      </header>

      <div hlmCardContent>
        <ul class="m-0 grid list-none gap-3 p-0 leading-relaxed text-[var(--color-text)]">
          @for (claim of record().claims; track claim.claim_id) {
            <li class="border-t border-border pt-3 first:border-t-0 first:pt-0">{{ claim.text }}</li>
          }
        </ul>
      </div>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordCard {
  readonly record = input.required<PortfolioRecord>();
  readonly eyebrow = input.required<string>();
  readonly headingLevel = input<3 | 4>(3);
}
