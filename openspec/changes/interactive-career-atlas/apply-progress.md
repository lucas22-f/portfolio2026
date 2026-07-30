# Apply Progress: Interactive Career Atlas

## Completed Tasks

- [x] 1.1 Route threat-matrix tests
- [x] 1.2 Safe route redirects and resolved root content

## TDD Cycle Evidence

| Task | Test File                                            | Layer              | Safety Net                     | RED                                            | GREEN                                                    | TRIANGULATE                                                                                    | REFACTOR                                                  |
| ---- | ---------------------------------------------------- | ------------------ | ------------------------------ | ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1.1  | `frontend/src/app/features/portfolio-routes.spec.ts` | Router integration | 6/6 passing                    | 8 new assertions failed against the old routes | 11/11 passing after the redirect contract                | Fixed legacy fragment replacement added and passing                                            | Route cases grouped by externally visible URL contract    |
| 1.2  | `frontend/src/app/features/portfolio-routes.spec.ts` | Router integration | Covered by task 1.1 safety net | RED assertions existed before route edits      | 11/11 passing with root resolver and `RedirectFunction`s | Legacy mappings, query preservation, direct assistant route, and wildcard cover distinct paths | `redirectToFragment` centralizes fixed-fragment redirects |

## Work Unit Evidence

| Evidence                                          | Result                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command and exact result             | After `npm.cmd exec -- prettier --write src/app/app.routes.ts src/app/features/portfolio-routes.spec.ts` normalized `app.routes.ts` (route spec unchanged), `npm.cmd test -- --include=src/app/features/portfolio-routes.spec.ts --watch=false` exited 0 with 1 test file and 11 tests passed. |
| Runtime harness command/scenario and exact result | The final RouterTestingHarness integration suite exercised all legacy mappings, a legacy query, an incoming legacy fragment, `/chat`, direct `#assistant`, and the wildcard; exit 0, 11 tests passed.                                                                                          |
| Rollback boundary                                 | Revert `frontend/src/app/app.routes.ts` and `frontend/src/app/features/portfolio-routes.spec.ts`; this restores the previous public-route composition without touching landing/chat implementation.                                                                                            |

## Constraint / Deviation

Back/Forward heading focus and fragment scroll/focus cannot be implemented in `app.routes.ts`: the existing `JourneyPage` does not yet expose the planned `intro`, `experience`, `projects`, and `assistant` semantic headings. Those behaviors remain a PR 2 landing responsibility. This slice keeps route redirects fixed, query-preserving, and lock-neutral without freelancing into the landing implementation.

## Correction: Unified Landing Cutover

Native review lineage `review-952f40a1eb21acc9` required the routing cutover to include its minimal landing owner. `JourneyPage` now renders the four semantic sections from resolved portfolio content and keeps `ChatPage` absent until the final explicit completion action. The correction adds 119 authored runtime/test lines before this evidence update, below the registered 200-line forecast.

| TDD cycle     | Evidence                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Safety net    | `journey-page.spec.ts`: 4/4 passed before the correction.                                                                       |
| RED           | Two new journey assertions failed: no semantic sections and no unlock CTA/embedded chat.                                        |
| GREEN         | `npm.cmd test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false`: exit 0, 4/4 passed.                    |
| Triangulation | `portfolio-routes.spec.ts` verifies the resolved root renders both reusable experience and project cards; exit 0, 11/11 passed. |
| Refactor      | Reused `RecordCard` and `ProjectCard`; no visual library or persistence introduced.                                             |

The runtime harness is the two focused Angular integration suites: route redirects resolve the content-bearing landing, and the journey suite verifies the locked assistant is revealed only after explicit completion. Rollback boundary: `journey-page.ts`, `journey-page.spec.ts`, and the two route files; reverting them restores the prior routing-only cutover.

## Landmark Correction

- Safety net: `journey-page.spec.ts` passed 4/4 before the edit.
- RED: unlock produced two `main` landmarks and duplicate `#main-content`.
- GREEN: the focused journey suite passed 4/4 with ChatPage as the sole unlocked landmark.

## Generation 2 Correction

`review-b5e220ca1946d839` keeps the landing mounted after unlock, gates its controls by section order, and focuses semantic headings for initial and changed fragments. Scoped JourneyPage and router suites passed 5/5 and 12/12; this generation uses 69/200 authored correction lines.

## Remaining Tasks

- [ ] 1.3 Route helper and obsolete portfolio-page cleanup after composed-card coverage
- [x] 2.1-2.4 Gated landing and intentional chat focus
- [ ] 3.1-3.3 Visual-system admission and verification

## PR Boundary

PR 1 (stacked-to-main): safe routing contract only. Authored code and test changes are limited to `app.routes.ts` and `portfolio-routes.spec.ts`; progress metadata records the unit.

## PR 2 Behavioral Landing Cutover

### Completed Tasks

- [x] 2.1 Focused RED coverage for semantic order, lock/reload behavior, explicit entry focus, motion-safe reveal, and header removal.
- [x] 2.2 Journey-owned in-memory unlock and explicit assistant navigation.
- [x] 2.3 Embedded chat `focusOnEntry` contract with intentional heading focus.
- [x] 2.4 Header/navigation removal while retaining the skip link, outlet, and a single journey-owned main landmark.

### TDD Cycle Evidence

| Task | Test File                                                  | Layer             | Safety Net                             | RED                                                                                                                                                                                  | GREEN                                                                        | TRIANGULATE                                                                                                                     | REFACTOR                                                                  |
| ---- | ---------------------------------------------------------- | ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 2.1  | `journey-page.spec.ts`, `chat-page.spec.ts`, `app.spec.ts` | Angular component | 5/5 journey, 4/4 chat, 3/3 app passing | Initial-fragment reading-order assertion did not compile because `focusFragment` had no initial-load parameter; focused-entry and no-nav assertions specified the missing contracts. | After focused implementation, journey 5/5, chat 5/5, and app 3/3 passed.     | Covers initial vs later fragment navigation, default vs explicit chat entry focus, and locked vs explicitly unlocked assistant. | Tests assert semantic focus/landmarks rather than CSS details.            |
| 2.2  | `journey-page.spec.ts`                                     | Angular component | 5/5 baseline                           | Existing test strengthened to require focus after explicit unlock; it was written before the navigation implementation.                                                              | 5/5 passed after journey-owned `navigateToAssistant()` and in-memory unlock. | Observer reveal remains visible while unlock state remains false.                                                               | Single journey main landmark owns skip-link target.                       |
| 2.3  | `chat-page.spec.ts`                                        | Angular component | 4/4 baseline                           | `focusOnEntry=true` case introduced before input implementation.                                                                                                                     | 5/5 passed after conditional entry focus.                                    | Default no-focus and explicit focus both covered.                                                                               | Chat is a labelled section so the journey remains the sole main landmark. |
| 2.4  | `app.spec.ts`                                              | Angular component | 3/3 baseline                           | Header/nav removal assertion added before template removal.                                                                                                                          | 3/3 passed after preserving skip link and outlet.                            | The E2E source assertions now navigate by fragments instead of removed links; Playwright was not run.                           | Removed unused router-link imports and header CSS.                        |

### Work Unit Evidence

| Evidence                                          | Result                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command and exact result             | `npm.cmd test -- --include=src/app/features/journey/journey-page.spec.ts --watch=false` -> exit 0, 1 file/5 tests; `chat-page.spec.ts` -> exit 0, 1 file/5 tests; `app.spec.ts` -> exit 0, 1 file/3 tests. |
| Runtime harness command/scenario and exact result | N/A during apply: Playwright is explicitly deferred to sdd-verify; E2E source assertions were updated but not executed.                                                                                    |
| Build evidence                                    | `npm.cmd run build` -> exit 0; initial bundle 307.68 kB raw / 80.98 kB estimated transfer.                                                                                                                 |
| Rollback boundary                                 | Revert the nine PR 2 files listed below; route redirects, content cards, backend contracts, and task 1.3 remain untouched.                                                                                 |

### Scope and Deviations

- Implemented reconciliation correction: initial deep links scroll without stealing reading-order focus; subsequent fragment changes focus their semantic heading.
- No Spartan/Motion install, dependency change, Phase 3 work, task 1.3 deletion, Playwright execution, or lifecycle/Git actions.
- Authored diff: 317 lines (169 additions + 148 deletions, including SDD artifacts), under the 400-line PR 2 budget.

### Remaining Tasks

- [ ] 1.3 Route-helper cleanup and portfolio-page deletion, explicitly deferred.
- [ ] 3.1-3.3 Dependency admission and visual-system verification, explicitly deferred.
