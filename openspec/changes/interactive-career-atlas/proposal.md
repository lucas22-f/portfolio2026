# Proposal: Interactive Career Atlas

## Intent

Replace fragmented public pages with one narrative that makes the grounded assistant an earned conversion climax.

## Scope

### In Scope
- One continuous Angular landing in the fixed order: intro/who I am, experience/work, projects, assistant; no conventional header navbar or visually separate public pages.
- Accessible, in-memory journey completion that unlocks the assistant through scroll, keyboard, and touch-safe progression—not animation completion—and resets on reload.
- Landing fragments, history/deep-link behavior, and legacy-route redirects to equivalent sections; persistent accessible return-to-assistant control after unlock.
- Reuse chat client/backend integration; prevent its initial autofocus from stealing focus, and move focus only after intentional assistant navigation or unlock.
- Refine dark navy/emerald semantic tokens, mobile layout, keyboard flow, reduced-motion behavior, and budgets. Integrate a minimal, purposeful subset of Spartan UI components and Motion/native Angular CSS motion—not blanket adoption—within accessibility and bundle limits.

### Out of Scope
- Supabase, Resend, lead/contact endpoints, persistence, notifications, environment variables, or simulated lead delivery.
- A parallel design system, cross-session unlock storage, and changes to grounded content or chat backend contracts.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `guided-portfolio-experience`: replace classic navigation and persistent chat bypass with the continuous, gated, accessible landing journey and fragment-compatible routing.
- `grounded-portfolio-chat`: preserve grounded behavior while requiring intentional focus behavior when the chat is embedded and unlocked in the landing.

## Approach

Compose existing journey, portfolio cards, and chat inside the root landing. Use stable semantic IDs and compatibility redirects. Keep unlock state in an in-memory owner, and integrate the scoped Spartan and motion primitives under the existing budgets.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `frontend/src/app/app.routes.ts` | Modified | Landing fragments and legacy redirects |
| `frontend/src/app/features/journey/` | Modified | Narrative and unlock owner |
| `frontend/src/app/features/chat/` | Modified | Embedded gated chat and intentional focus |
| `frontend/src/styles.css` | Modified | Semantic brand tokens and motion rules |
| `frontend/src/app/**/*.spec.ts` | Modified | Strict-TDD journey and routing coverage |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Fragment/focus regressions | Medium | Specify and test history, keyboard, mobile, and reduced-motion flows |
| Bundle growth | Medium | Admit UI/motion dependencies only within existing budgets |

## Rollback Plan

Revert the landing, route, token, and focus changes together to restore the prior route composition; no data migration or backend rollback is required.

## Dependencies

- Runtime: Angular 22, Tailwind CSS v4, Angular Aria, grounded chat APIs, and the scoped Spartan/motion additions.
- Workflow: existing `frontend-craft` and the official Spartan agent skill are required implementation guidance, not runtime dependencies.

## Success Criteria

- [ ] Visitors can complete the narrative accessibly and unlock the assistant without animation timing.
- [ ] Reload relocks the assistant; legacy URLs resolve to equivalent landing fragments.
- [ ] Chat remains grounded, never steals initial landing focus, and performance/accessibility budgets pass.
