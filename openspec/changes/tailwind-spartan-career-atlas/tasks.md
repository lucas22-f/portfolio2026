# Tasks: Tailwind + Spartan Career Atlas

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 540â€“760 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Split | PR 1 â†’ PR 2 â†’ PR 3; each targets `main` after its predecessor merges |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Official Spartan foundation | PR 1 â†’ `main` | `cd frontend; npm test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` | N/Aâ€”verify-only | Spartan config, Brain, Helm, progress tests |
| 2 | Utility-first surfaces | PR 2 â†’ `main`, after PR 1 | `cd frontend; npm test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` | N/Aâ€”verify-only | Journey/card/chat templates, CSS, specs |
| 3 | Runtime evidence | PR 3 â†’ `main`, after PR 2 | `cd frontend; npm run build` | External Windows server + desktop/390px Chromium | Playwright config/e2e evidence |

## Phase 1: Official Progress Foundation (PR 1)

- [x] 1.1 **RED:** Extend `frontend/src/app/features/journey/journey-page.spec.ts` for Brain/Helm host, 0/25/50/75/100 labels, passivity, Continue-only advancement, relock, and chat focus; run Unit 1 filtered.
- [x] 1.2 **GREEN:** Read the official Spartan skill, run its read-only discovery, initialize missing `frontend/components.json` and apply only its emitted Brain Progress setup; add the exact discovered dependency/import plus CLI-copied Helm Progress filesâ€”no native/custom/equivalent progress substitute.
- [x] 1.3 Implement `progressPercent = assistantUnlocked() ? 100 : progress() * 25` and discovery-owned Helm/Brain rendering; expose name/value text, retaining Continue as sole transition/focus API; rerun Unit 1.
- [x] 1.4 **REFACTOR:** Remove test duplication and document generated-file provenance without altering behavior.

## Phase 2: Utility-First Composition (PR 2)

- [ ] 2.1 **RED:** Add journey/chat/card assertions for initial/return focus, relock, keyboard, and Tailwind utilities; run `npm test -- --include=src/app/features/chat/chat-page.spec.ts --watch=false` separately.
- [ ] 2.2 **GREEN:** Migrate journey, `shared/{project-card,record-card}/*`, and `features/chat/*` layout/responsive/type/surface/interaction composition to Tailwind v4 utilities; preserve semantics and touch targets.
- [ ] 2.3 Retain only tokens, pseudo/focus, skip-link, `:host`, assistant reveal, and complex reduced-motion CSS; delete equivalent BEM rules and add no Motion.
- [ ] 2.4 **REFACTOR:** Rerun the scoped specs; verify no utility is merely decorative over retained equivalent CSS.

## Phase 3: Explicit Runtime Verification (PR 3)

- [ ] 3.1 **RED (verify-only):** Extend `frontend/e2e/portfolio-journeys.spec.ts` for official Brain/Helm identity (not role-only), passive progress, direct-assistant lock, focus/unlock/reload relock, reduced motion, keyboard/touch, and 390px overflow.
- [ ] 3.2 Set `webServer` off in `frontend/playwright.config.ts`; on Windows externally start `npm run start -- --host 127.0.0.1`, record PID, wait for `127.0.0.1:4200`, run `npm run test:e2e -- portfolio-journeys.spec.ts`, and terminate that PID in `finally`.
- [ ] 3.3 Run `cd frontend; npm run build`; record 500 kB/4 kB warnings and require no 1 MB/8 kB errors. Run E2E only in explicit `sdd-verify` after browser installation.
- [ ] 3.4 Update OpenSpec evidence as applicable; use issue-first, conventional commits, CI, and one stacked PR per authorized completed unit.
