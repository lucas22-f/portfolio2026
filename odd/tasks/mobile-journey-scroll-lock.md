# Mobile Journey Scroll Lock

## Objective
Make mobile journey screens advance only through their CTA buttons while preserving scrolling within each screen when content overflows, and leave desktop scrolling behavior unchanged.

## Problem and Why
The journey page stacks viewport-height sections in normal document flow, so mobile users can scroll the document into later sections without using the gated CTAs. The guided narrative should communicate the next action clearly and keep long content reachable rather than clipping it.

## Scope and Constraints
- Mobile only: prevent document-level scrolling from changing the active journey screen; keep desktop document scrolling unchanged.
- Allow internal vertical scrolling inside long sections, especially experience.
- Preserve keyboard activation, focus transfer, fragment/deep-link navigation, existing progress gating, reduced-motion behavior, and touch targets (at least 44px).
- Use existing Tailwind/Spartan semantic color tokens and primary button styling for contrast.
- Add the instruction: “Presioná el botón para continuar el recorrido.”
- Do not alter unrelated chat files or `frontend/e2e/portfolio-journeys.spec.ts`; stage only the authorized journey and task files.
- No E2E tests. No native review; RDD effective mode is off.

## Authorized Files
- `frontend/src/app/features/journey/journey-page.ts` — journey template and navigation behavior.
- `frontend/src/app/features/journey/journey-page.css` — responsive panel/scroll behavior.
- `frontend/src/app/features/journey/journey-page.spec.ts` — focused unit coverage.
- `odd/tasks/mobile-journey-scroll-lock.md` — recovery and verification record.

## Route and TDD
- Route: delegated direct, one writer.
- Trigger evidence: implementation changes component behavior, responsive styles, and focused tests (three non-trivial files); exploration/preparation has been completed by the mapping handoff.
- TDD mode: false, authoritative source `openspec/config.yaml`.
- Exact focused test runner: from `frontend/`, `npm test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false`.
- Build check: from `frontend/`, `npm run build`.
- Test output must be filtered per `test-output-protocol`; no E2E.
- Delivery strategy: `ask-on-risk`.
- RDD status: effective off (provided for this task); no review lifecycle.

## Conservative Forecast
Approximately 150 authored changed lines across implementation, focused tests, and this task record; generated files excluded. This is one coherent behavior and below the advisory 400-line planning heuristic.

## Acceptance Criteria
- [x] MJS-1: All viewport sections are internal mobile scroll containers with overscroll containment, preventing scroll chaining into the document; button-driven scrolling and existing focus/deep-link code remain intact.
- [x] MJS-2: Experience and assistant now scroll internally on mobile and retain their existing desktop overflow-hidden behavior at `sm` and wider; intro/projects retain their prior internal scroll behavior.
- [x] MJS-3: Added the requested mobile-only instruction for each guided CTA and emphasized primary buttons with a border/shadow/focus ring while retaining 44px touch targets and reduced-motion behavior.
- [x] MJS-4: Focused specs cover scroll-container classes, desktop responsive overflow classes, mobile instructions/CTA emphasis and guided progression.

## Progress and Evidence
- [x] Mapping: root cause and relevant component/styles/specs identified; no files changed.
- [x] Implementation and focused specs.
- [x] Verification: focused unit spec and frontend build completed; details below.
- [x] Parent diff readback and independent verification; unrelated changes remain untouched.
- [x] Risk review: `gentle-ai review assess --cwd <repo> --json` returned an untracked-file declaration requirement; per ODD, the assessment is unassessable/high. Independent verifier found no blockers. RDD is off, so no native review lifecycle was started.
- [ ] Work-unit commit on `fix/mobile-journey-scroll-lock`; stage only authorized journey/task files and record commit identity here.

## Verification Results
Passed: `cd frontend && npm.cmd test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` — 1 test file, 20 tests passed (exit 0).

Passed: `cd frontend && npm.cmd run build` — bundle generation complete (exit 0). Existing initial bundle budget warning remains: 501.17 kB vs 500.00 kB budget (1.17 kB over).

No E2E or browser visual/contrast verification was run; browser execution is unproven and the focused unit/build checks were used for this implementation.
