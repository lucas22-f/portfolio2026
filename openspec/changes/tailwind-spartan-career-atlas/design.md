# Design: Tailwind + Spartan Career Atlas

## Technical Approach

Keep `JourneyPage.progress()` as the sole status signal and render genuine Spartan Brain Progress with repository-owned Helm styling. Tailwind v4 utilities become the primary template composition layer; only irreducible behavior stays in CSS. No routing, backend, or persistence changes.

## Architecture Decisions

| Decision | Choice | Rationale / rejected alternative |
|---|---|---|
| Spartan setup | During apply, install/read the official skill, run read-only discovery, initialize missing `components.json`/configuration, and add **only Progress**. Use discovery-emitted package, command, paths, and import; commit copied Helm files. | The repo lacks Spartan configuration, Brain, and Helm. A guessed import or native bar fails the requirement. |
| Progress contract | Import the discovered Brain primitive and generated Helm component into `JourneyPage`; derive `progressPercent` as `assistantUnlocked() ? 100 : progress() * 25` and label 0/25/50/75/100 (intro, experience, projects, assistant-ready, unlocked). | Display-only: no click, scroll, observer, focus, routing, unlock, or navigation handler. |
| Utility composition | Put layout, responsive, type, color, button, and interaction classes on existing semantic/card/chat templates; delete equivalent BEM declarations. | Tailwind must be observable, not decorative CSS layered over BEM. |
| CSS boundary | Retain tokens, `:focus-visible`, skip-link, touch-action, global reduced motion, `:host`, and irreducible pseudo/assistant-reveal rules only. | Prevents utility-replaceable composition CSS from surviving. |
| Motion | Do not add Motion. A later change may admit decorative-only motion only after a bundle, reduced-motion, and cleanup design. | No journey behavior needs it; avoiding it protects accessibility and budgets. |

## Data Flow

```text
Continue button -> advance(next) -> progress signal -> 0/25/50/75 progress display
unlock button -> progress===3 -> assistantUnlocked -> 100 progress display + chat render + focus
scroll/fragment observer -> reveal or section focus only (never progress/unlock)
```

`advance()` remains the exclusive transition and queues focus to the next heading. Reload relocks. `ChatPage` gets `[focusOnEntry]="true"` only after unlock/return; the bar cannot cause it or `focusEntry()`.

## File Changes

| File | Action | Description |
|---|---|---|
| `frontend/package.json`, `package-lock.json` | Modify | Minimum official Brain dependency discovered for Progress. |
| `frontend/components.json` and official Spartan setup files | Create/Modify | Generated only by official init/discovery when missing. |
| discovered Helm Progress files under `frontend/src/app/...` | Create | CLI-copied, repository-owned Progress styles/component; do not substitute custom markup. |
| `frontend/src/app/features/journey/journey-page.ts`, `.css`, `.spec.ts` | Modify | Brain/Helm import, state mapping, utility-first landing, CSS exceptions, RED-first tests. |
| `frontend/src/app/shared/{project-card,record-card}/*`, `frontend/src/app/features/chat/*` | Modify | Utility-first composition; preserve inputs and semantics. |
| `frontend/src/styles.css` | Modify | Preserve tokens/global safeguards and add only discovery-required Tailwind/Helm integration. |
| `frontend/e2e/portfolio-journeys.spec.ts`, `playwright.config.ts` | Modify | Runtime primitive, keyboard/mobile, and externally managed-server verification. |

## Interfaces / Contracts

```ts
readonly progress = signal<0 | 1 | 2 | 3>(0);
readonly progressPercent = computed(() => assistantUnlocked() ? 100 : progress() * 25);
readonly progressLabel = computed(() => /* 0..100 current/completed text */);
// Continue-only advance() and unlockAssistant() remain unchanged as the state API.
```

The generated Helm component's selector/import is discovery-owned. Its accessible name/value text MUST expose `progressPercent`; `aria-valuenow` is 0--100 and an `aria-valuetext` reports current/completed step. Tests must assert the rendered Brain/Helm host/directive, not merely an equivalent `role="progressbar"` wrapper.

## Testing Strategy

Strict TDD: first add focused failing specs for 0/25/50/75/100 state labels (100 only after explicit unlock), passive progress, Continue focus, relock, chat-return focus, and reduced motion; then minimally implement. Use scoped Angular Vitest commands only. During explicit verify, enforce existing 500 kB warning/1 MB error initial and 4/8 kB style budgets.

Playwright verification starts `npm run start -- --host 127.0.0.1` as an external Windows process, records its PID, waits for `127.0.0.1:4200`, runs focused desktop and 390px Chromium scenarios, then terminates that PID in `finally`. Disable Playwright `webServer` to avoid duplicates. Assert keyboard/touch targets, no horizontal overflow, passive progress, locked direct assistant, and reduced-motion usability.

## Threat Matrix

N/A — no new routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The verify harness is a test-only external server and must have deterministic PID cleanup.

## Migration / Rollout

No data migration or flag. Deliver as stacked-to-main work units: (1) official setup + Brain/Helm and tests, (2) journey/card/chat utility migration and tests, (3) verification evidence. Forecast and slice if authored change exceeds 400 lines. Roll back all three visual work units together: remove Spartan setup/dependency and Helm files, restore the previous templates/CSS and coupled tests; journey state, routes, and backend remain untouched.

## Open Questions

None — the official discovery output is intentionally the authority for generated paths and imports.
