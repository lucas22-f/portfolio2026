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
- Dependency correction: removed direct `tw-animate-css`; it remains only as transitive package metadata and is not a root dependency.
- Focused verification: `npm.cmd test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` exited 0 with 9 passing tests.
