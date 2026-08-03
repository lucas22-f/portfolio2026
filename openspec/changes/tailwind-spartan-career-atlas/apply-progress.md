# Apply Progress: PR 1 — Official Progress Foundation

## Completed

- 1.1 RED: Journey-focused Angular spec added for Brain/Helm progress identity, discrete 0/25/50/75/100 state labels, passivity, Continue-only advancement, relock, and intentional chat focus.
- 1.2 GREEN: Official Spartan CLI discovery reported an Angular CLI workspace with no configuration; official init installed Brain and Tailwind integration. The `ui progress` generator copied Helm Progress and its required Helm utility into `src/app/shared/ui/`.
- 1.3 GREEN: `JourneyPage` renders official `[hlmProgress]` plus `[hlmProgressIndicator]`; `progressPercent` follows `assistantUnlocked() ? 100 : progress() * 25`, and Brain supplies the accessible progress role/value/text. The progress host has no event binding or focus/unlock/navigation behavior.
- 1.4 REFACTOR: Tests use one progress host lookup per state test; generated components are repository-owned copies under `frontend/src/app/shared/ui/` and must be upgraded through the official Spartan CLI rather than manually substituted.

## Evidence

- RED: `npm.cmd test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` exited 1 because `JourneyPage.progressPercent` did not yet exist.
- GREEN: the same scoped command exited 0: 1 test file, 9 tests passed.
- Runtime harness: N/A for PR 1; Playwright runtime checks belong to Phase 3 by the task plan.
- Rollback boundary: remove Spartan config/dependencies, copied Helm Progress/utility files, Journey progress rendering, and the coupled focused specs; no routing/backend state is changed.

## Setup Caveat

`@spartan-ng/cli:ui` prompted despite `--defaults` when no config existed in this non-interactive Windows shell. The config schema was written using the CLI's discovery defaults (`src/app/shared/ui`, `@spartan-ng/helm`, `nova`), then the official `ui progress` generator created the copied files.
## Corrective Apply Evidence

- Delivery exception: the maintainer explicitly authorized `size:exception` for official Spartan generated dependency/lockfile setup.
- Global CSS correction: preserved the portfolio's existing brand tokens and safeguards; retained only the minimal `@spartan-ng/brain/hlm-tailwind-preset.css` import required by generated Helm Progress.
- Accessibility correction: restored the exact UTF-8 label `Introducción: 0% completado`; the focused spec now asserts the complete accessible value text.
- Dependency correction: during the PR2 corrective rerun, removed direct `tw-animate-css`; it is now available only transitively through `@spartan-ng/brain`, which imports the official preset.
- Focused verification: `npm.cmd test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` exited 0 with 9 passing tests.

## PR 2 — Utility-First Surfaces

### Completed

- 2.1 RED: Added focused heading hierarchy and relocked deep-section recovery assertions. Corrective reruns added narrow Tailwind utility contract assertions for journey layout, chat touch controls, and project surface/evidence layout, plus an explicit native Continue keyboard assertion: Enter is not intercepted, and the browser-equivalent click advances progress and moves focus to the next heading. These assert required composition/control behavior rather than decorative styling.
- 2.2 GREEN: Official Spartan discovery reconfirmed selectors before generation. Generated only Button, Card, Badge, and Separator Helm copies, then applied them where they convey real semantics: Continue/recovery actions, record/project surfaces, reviewed technology tags, and project evidence division.
- 2.3: Replaced journey, chat, and card BEM composition with Tailwind v4 utilities. CSS is now limited to `:host`, the profile pseudo-selector, and the assistant reveal/reduced-motion transition. No Motion dependency was added. `scrollIntoView` is smooth by default and switches to `auto` for `prefers-reduced-motion`.
- 2.4 REFACTOR: Corrected the primary semantic token to `#047857` with white foreground (instead of white on `#10b981`, previously measured at 2.54:1), eliminated the nested Chat H1, and made record-card heading depth contextual (H3 experience, H4 fact groups). A locked/reloaded deep assistant section now offers a non-progressing return-to-intro action; Continue remains the sole progression source.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `journey-page.spec.ts`, `chat-page.spec.ts`, `project-card.spec.ts`, `record-card.spec.ts` | Component | Existing focused suites run before edits | Added heading/recovery, utility-contract, and native keyboard assertions | All scoped suites pass | Locked/recovery, unlocked/focus, surface/control utility, and Enter activation paths | Semantic selectors replace retired BEM selectors |
| 2.2 | Same focused component specs | Component | Existing focused suites run before edits | Existing semantic rendering tests preserved | 5 chat, 3 project, 1 record, 10 journey tests pass | Record H3/H4 and project H3 render paths | Helm imports localize presentation behavior |
| 2.3 | `journey-page.spec.ts` | Component | Existing journey suite | Reduced-motion-safe reveal retained | 10 journey tests pass | Smooth scroll retains focus and recovery path | CSS reduced to documented exceptions |
| 2.4 | All focused component specs | Component | Focused suites | Retired selector assertion exposed refactor coupling | All scoped suites pass | Four independent surface suites | Removed duplicate styling rules |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `cd frontend && npm.cmd test -- --include=src/app/features/chat/chat-page.spec.ts --watch=false` — exit 0, 1 file / 6 tests passed. |
| Focused test command | `cd frontend && npm.cmd test -- --include=src/app/shared/project-card/project-card.spec.ts --watch=false` — exit 0, 1 file / 4 tests passed. |
| Focused test command | `cd frontend && npm.cmd test -- --include=src/app/shared/record-card/record-card.spec.ts --watch=false` — exit 0, 1 file / 1 test passed. |
| Focused test command | `cd frontend && npm.cmd test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` — exit 0, 1 file / 12 tests passed. |
| Runtime harness | N/A — Phase 3 exclusively owns external server/Playwright runtime validation. |
| Spartan healthcheck | Read-only healthcheck passed all local API/import/scaffold checks; only remote package metadata fetches failed, without a local code defect. |
| Rollback boundary | Revert PR2 Tailwind templates/CSS, generated Button/Card/Badge/Separator Helm directories, semantic token mapping, and focused specs. Journey progression, routes, backend, and PR1 Progress remain intact. |

### CSS Exceptions

- `src/styles.css`: project brand and Spartan semantic token mapping, global focus/skip/touch/reduced-motion safeguards.
- `journey-page.css`: `:host`, profile pseudo-selector, and reveal/reduced-motion behavior that is not a template-composition concern.
- `chat-page.css`, card CSS: `:host` only.

### Scope Note

The maintainer authorized a PR2 size exception. The current diff is above the original 400-line target because generated Helm files plus the required deletion of equivalent BEM CSS are both review-visible; Phase 3 E2E and build work remains excluded.

### Review Correction

- Corrected Journey and Chat responsive arbitrary `min()` width utilities with Tailwind's underscore-encoded whitespace syntax. Focused utility-contract assertions now cover both mobile and `sm` width expressions.
