# Tasks: Interactive Career Atlas

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 700-1,050 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 2 -> PR 3; each targets main and merges in order |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Safe route contract | PR 1 -> main | `npm test -- --include=src/app/features/portfolio-routes.spec.ts --watch=false` | Router legacy/deep-link history scenario | `app.routes.ts`, route spec |
| 2 | Gated landing/chat | PR 2 -> main | `npm test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` | keyboard unlock + return-control focus | journey/chat files + specs |
| 3 | Admitted visual polish | PR 3 -> main | `npm run build` | mobile/reduced-motion landing walkthrough | styles, admitted deps, Spartan files |

## Phase 1: Routing RED -> GREEN -> REFACTOR

- [x] 1.1 **RED:** In `frontend/src/app/features/portfolio-routes.spec.ts`, add threat-matrix cases: every legacy mapping, fixed-fragment-only redirects, locked `/chat`/`#assistant`, unknown->`#intro`, query preservation/replaced history, and Back/Forward heading focus.
- [x] 1.2 **GREEN:** Update `frontend/src/app/app.routes.ts` with resolved root content and safe `RedirectFunction`s; fragment navigation scrolls/focuses existing section headings without setting unlock state.
- [ ] 1.3 **REFACTOR:** Simplify route helpers and remove `frontend/src/app/features/portfolio/portfolio-page.*` only after composed-card coverage passes.

## Phase 2: Narrative and intentional chat RED -> GREEN -> REFACTOR

- [ ] 2.1 **RED:** Extend `journey-page.spec.ts` for semantic `intro->experience->projects->assistant`, reload relock, keyboard/touch buttons, reduced motion, mobile controls, and no animation-driven unlock; extend `chat-page.spec.ts` for no initial autofocus and intentional entry focus while retaining ChatClient validation assertions.
- [ ] 2.2 **GREEN:** Modify `journey-page.{ts,css}` to compose existing cards and locked assistant; page-owned signal unlocks only explicit controls, then reveals `ChatPage`, persistent return control, scrolls, and requests entry focus.
- [ ] 2.3 **GREEN:** Modify `chat-page.{ts,css}` with `focusOnEntry=false` default and accessible entry heading focus only after unlock/return; preserve provider/grounded behavior.
- [ ] 2.4 **REFACTOR:** Remove navbar in `app.html`, `app.ts`, `app.css`, retaining skip link/outlet and reading-order initial focus.

## Phase 3: Admission, visual system, verification

- [ ] 3.1 **RED/setup:** Install/load official Spartan skill (`npx skills add spartan-ng/spartan`), read it, run read-only project info/discovery; document admission against native/Angular Aria semantics, accessibility, and 500 kB/1 MB + 4/8 kB budgets before dependency changes.
- [ ] 3.2 **GREEN:** Only if admitted, add minimal Spartan Brain Progress/copied Helm styles and `motion`; otherwise use native/CSS fallback. Motion dynamic import must be reduced-motion-gated, decorative-only, and destroyed cleanly.
- [ ] 3.3 **REFACTOR:** Update `styles.css` semantic navy/emerald tokens, focus/mobile/reduced-motion rules; no global smooth scroll. Run scoped Vitest commands and `npm run build`; reserve Playwright a11y/mobile for `sdd-verify`.
