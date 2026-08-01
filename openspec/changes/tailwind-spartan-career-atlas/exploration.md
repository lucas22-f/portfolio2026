## Exploration: Tailwind + Spartan Career Atlas

### Current State

The Angular 22 standalone, zoneless landing is already a single `JourneyPage` with explicit Continue controls, in-memory progress, reload relock behavior, legacy fragment redirects, and an embedded locked/unlocked chat. However, Tailwind v4 is only globally imported in `styles.css`: the journey and reusable cards remain composed almost entirely with BEM classes and component CSS. There are no Spartan dependencies, generated Helm files, `components.json`, or runtime Brain/Helm progress imports.

`JourneyPage` currently advances `0 -> 3` only through buttons and focuses the next section. Its `progress()` state is therefore the correct single source for a passive, semantic progress display. It must remain display-only: neither scrolling nor the progress primitive may advance the journey, unlock chat, move focus, or alter navigation.

### Affected Areas

- `frontend/src/app/features/journey/journey-page.ts` — replace layout/spacing/type/color/state BEM composition with Tailwind utilities and render the genuine Brain-backed Helm progress primitive from `progress()`.
- `frontend/src/app/features/journey/journey-page.css` — retain only behavior Tailwind cannot express cleanly (host/global integrations, specialized pseudo/focus behavior, and any complex reduced-motion rule); remove utility-replaceable BEM rules.
- `frontend/src/app/shared/{project-card,record-card}/*` and `frontend/src/app/features/chat/*` — migrate landing-composition styles to utilities as needed, without destabilizing their existing semantic/behavioral contracts.
- `frontend/src/styles.css` — preserve semantic tokens and global focus/reduced-motion policy; configure Tailwind v4 layers/preset only as confirmed by Spartan discovery.
- `frontend/package.json`, `frontend/package-lock.json`, Spartan CLI/setup files, and generated Helm Progress files — add only the official minimum necessary for Brain Progress plus copied Helm Progress styling.
- `frontend/src/app/features/journey/journey-page.spec.ts` and focused routing/chat specs — prove state-to-progress semantics, explicit advancement/focus, relock, and reduced-motion behavior.
- `frontend/playwright.config.ts` and focused e2e coverage — verify desktop and 390px keyboard/touch/overflow behavior with an externally managed Angular server and PID cleanup during the verify phase.

### Approaches

1. **Official Spartan setup, then targeted Tailwind migration** — run the required official skill/discovery, initialize Spartan even when no config exists, add only Progress, then move component composition into utility classes while retaining documented CSS exceptions.
   - Pros: Meets the runtime-verifiable Brain + Helm requirement, avoids fake wrappers and duplicate primitives, and makes Tailwind v4 the real composition layer.
   - Cons: Introduces a small setup/dependency change and requires disciplined CSS deletion rather than utility classes layered over BEM.
   - Effort: Medium.

2. **Custom native progress styled with Tailwind** — retain the current signal and create an ARIA progress bar without Spartan.
   - Pros: Smallest implementation and dependency footprint.
   - Cons: Fails the explicit requirement for maintained Spartan Brain Progress and Helm styles.
   - Effort: Low, but unacceptable.

### Recommendation

Adopt approach 1. Treat the missing Spartan configuration as first-class setup: install the official skill, read it, run its read-only discovery, add the official CLI/configuration, and generate only Progress. Official Spartan documentation confirms the required split: `@spartan-ng/brain` supplies maintained accessible behavior, while Helm is copied into the repository and styled with Tailwind utilities. The current Tailwind v4 installation satisfies the prerequisite but needs its layers/preset setup validated against the discovered CLI output.

Bind a 0/25/50/75/100 value to the existing discrete journey state (intro, experience, projects, assistant-ready, assistant-unlocked) and supply an explicit accessible label/value text such as current/completed step. Continue buttons remain the exclusive state transition API and continue to intentionally focus the next section. The bar may update only after those transitions and must never imply that scrolling or animation advances access.

Use Tailwind utilities directly in templates for containers, grids, gaps, responsive columns, typography, colors, borders, hover/disabled/focus states, and spacing. Keep global tokens, global reduced-motion safeguards, and narrowly documented selectors/pseudo-elements in CSS. Do not add Motion unless a separate admission demonstrates a decorative-only use that remains within budgets and reduced-motion/cleanup requirements; nothing in the current journey requires it.

### Risks

- Replacing BEM incrementally without deleting its equivalent rules would leave Tailwind decorative rather than the composition system; review must inspect real template utilities and reduced component CSS.
- Spartan CLI output and current imports must be taken from its installed official discovery, not guessed; the repository currently has neither the Brain package nor Helm Progress files.
- `ChatPage` receives `[focusOnEntry]="true"` today, so its initial `ngAfterViewInit` can still focus the chat when it first renders. The implementation must preserve intentional focus only after unlock/return.
- Spartan/Tailwind preset integration and copied Helm styles can affect CSS budgets; production build and focused visual/a11y checks are mandatory verification gates.
- The stated Playwright server/PID requirements need validation during explicit verify, not this exploration; no test/build/install was run here.

### Ready for Proposal

Yes — the proposal should correct the prior “minimal purposeful Spartan subset” into an explicit, verifiable Brain Progress + copied Helm Progress integration, make Tailwind v4 template utilities the composition requirement, enumerate allowable CSS exceptions, and retain the existing journey state/focus/relock/no-backend boundaries.
