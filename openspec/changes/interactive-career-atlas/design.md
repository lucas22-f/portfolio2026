# Design: Interactive Career Atlas

## Technical Approach

Replace routed public views with one resolved `JourneyPage`: semantic `#intro → #experience → #projects → #assistant` sections. It composes record/project cards and `ChatPage`; the page-owned `signal<boolean>` is the only unlock state. No backend or chat contract changes.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Journey state | `JourneyPage` owns `assistantUnlocked`; explicit “Continue” controls and an end-of-content action call `unlockAssistant()`. Scroll observation may update a visual progress indicator only, never unlocks. Signal lifetime naturally resets on reload; no storage/store library. |
| Routes/fragments | Root route resolves content. `RedirectFunction` maps legacy `/perfil → /#intro`, `/experiencia|educacion|habilidades → /#experience`, `/proyectos → /#projects`, `/chat → /#assistant`; wildcard goes `/#intro`. Redirects preserve query params, replace the legacy history entry, and never set unlock state. Fragment scrolling locates existing semantic IDs; user/back-forward fragment navigation focuses that section heading after scroll, while first document load retains normal initial reading-order focus. |
| Assistant/focus | The locked assistant section exposes explanation plus the completion button, not `ChatPage`. After successful unlock or activated persistent return control, scroll then focus `ChatPage`’s new `@Input() focusOnEntry` entry heading. Embedded default is false, replacing its unconditional `ngAfterViewInit` focus. |
| UI primitives | Install only Spartan Brain Progress plus generated/copy-owned Helm progress styles for the accessible journey status; do not add a second headless control system or generic components. Before implementation install/load the official agent skill with `npx skills add spartan-ng/spartan`, then read its local skill and run its read-only info command. This is agent guidance, not a runtime dependency. |
| Motion | Add `motion` only after budget admission. A reduced-motion-gated dynamic import uses `scroll()` solely to drive a decorative CSS custom-property progress rail and cleans up on destroy. Native Angular `animate.enter`/CSS reveals the unlocked assistant and return control. Motion never changes route, focus, content, or unlock state; no 3D, global smooth scroll, or animation-gated behavior. |

Native semantic buttons/links are sufficient; Angular Aria remains for future complex interactions. Spartan Brain supplies maintained behavior and copied Helm styles remain owned. Angular enter classes are transient and Motion `scroll()` returns cleanup. [Angular Aria](https://angular.dev/guide/aria/overview) · [Angular animations](https://angular.dev/guide/animations) · [Spartan introduction](https://spartan.ng/documentation/introduction) · [Spartan skills](https://spartan.ng/documentation/skills) · [Motion scroll](https://motion.dev/docs/scroll)

## Data Flow

```
Router URL/fragment ──> JourneyPage ──> semantic section scroll/focus
content resolver ──────> cards in experience/projects
explicit completion ───> assistantUnlocked signal ──> ChatPage focusOnEntry
scroll observer/Motion ─> visual progress only
ChatPage ───────────────> existing ChatClient ──────> existing backend
```

## File Changes

| File | Action | Description |
|---|---|---|
| `frontend/src/app/app.routes.ts` | Modify | Root content resolver and safe legacy redirect functions. |
| `frontend/src/app/app.html`, `app.ts`, `app.css` | Modify | Remove conventional header/navigation; retain skip link and outlet. |
| `frontend/src/app/features/journey/journey-page.{ts,css,spec.ts}` | Modify | Compose ordered landing, in-memory lock, fragments, focus, responsive/reduced-motion progress. |
| `frontend/src/app/features/chat/chat-page.{ts,css,spec.ts}` | Modify | Embedded entry/focus contract; preserve ChatClient behavior. |
| `frontend/src/app/features/portfolio-routes.spec.ts` | Modify | Replace separate-view assertions with redirect, history, fragment, and lock tests. |
| `frontend/src/styles.css` | Modify | Navy/emerald semantic tokens, focus/reduced-motion rules; no global smooth scroll. |
| `frontend/package.json`, lockfile, generated Spartan files | Modify/Create | Only if skill-confirmed Progress and Motion pass admission. |
| `frontend/src/app/features/portfolio/portfolio-page.*` | Delete | No longer a routed public view after card composition is proven. |

## Interfaces / Contracts

```ts
// JourneyPage
readonly assistantUnlocked = signal(false);
unlockAssistant(): void;
navigateToAssistant(): void;

// ChatPage
@Input() focusOnEntry = false; // only true after explicit unlock/return
```

## Testing Strategy

Strict TDD: first update existing specs with RED assertions, then minimum production code. Unit/integration tests cover semantic order; locked `/chat` and `#assistant`; reload reset; button/keyboard/touch completion; return-control focus; no initial chat autofocus; reduced-motion classes; deep-link and Back/Forward focus/history. Preserve all `ChatClient` provider-validation tests. Run scoped Vitest tests, then production build; Playwright accessibility/mobile coverage remains an explicit verify-phase gate.

Dependency admission: use Spartan’s official skill/API discovery; install only selected packages, reject duplicate primitives. Build must remain below initial 500 kB warning/1 MB error and each component style below 4/8 kB; remove Motion/primitive or keep CSS-only if exceeded.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A | No execution/classification boundary. | — |
| Git repository selection | N/A | No Git command integration. | — |
| Commit state | N/A | No commit automation. | — |
| Push state | N/A | No push automation. | — |
| PR commands | N/A | No PR automation. | — |
| Routing/fragments | Applicable | Redirect only to fixed root fragments; direct assistant URL/fragment scrolls but remains locked; unknown route lands at intro. | Legacy mappings, direct bypass, query/history, Back/Forward, focus. |

## Migration / Rollout

No migration, flag, persistence, environment variable, or backend rollout. Revert landing/routes/styles together if needed.

## Open Questions

None.
