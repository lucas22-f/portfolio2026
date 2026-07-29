## Exploration: interactive-career-atlas

### Current State
The Angular 22 application is a strict, standalone, zoneless frontend with Tailwind CSS v4 and `@angular/aria` installed. The public experience is currently split across a root `JourneyPage`, five resolver-backed portfolio routes, and a dedicated `/chat` route; `App` renders a conventional global header and navbar. The root journey can reveal its terminal chat link after three local steps, but it also exposes an immediate `/chat` escape, so chat is not currently gated by the narrative.

Reviewed content is already centralized in `content/v1` and consumed by both portfolio views and chat. The existing `ChatPage` and `ChatClient` provide the reusable frontend integration: metadata compatibility check, NDJSON streaming, typed safe response rendering, Spanish status/error states, retry behavior, and keyboard focus on the chat heading. FastAPI already exposes `/api/v1/metadata` and `/api/v1/chat/stream`; this slice needs no backend, persistence, email, environment, or delivery-contract change.

The visual foundation already uses dark navy/emerald custom properties, a skip link, visible focus outlines, responsive widths, and global reduced-motion suppression. Angular Aria is installed but is not imported in the current source. Neither Spartan UI nor Motion appears in the current dependency graph. Native CSS transition plus `IntersectionObserver` is the only existing motion pattern. The production initial bundle budget is 500 kB warning / 1 MB error and individual component-style budget is 4 kB warning / 8 kB error.

### Affected Areas
- `frontend/src/app/app.routes.ts` — Replace the route-first public information architecture with one landing route while preserving direct deep-link/history entry points.
- `frontend/src/app/app.ts`, `frontend/src/app/app.html`, `frontend/src/app/app.css` — Remove the conventional header/navbar shell and retain the global skip-link and router outlet responsibilities.
- `frontend/src/app/features/journey/journey-page.ts` and `.css` — Best candidate to become the continuous narrative container and unlock state owner.
- `frontend/src/app/features/portfolio/portfolio-page.ts` and `.css` — Existing reusable content rendering can be composed as landing sections rather than route destinations.
- `frontend/src/app/shared/project-card/*` and `frontend/src/app/shared/record-card/*` — Existing grounded cards should remain the content primitives for work and projects.
- `frontend/src/app/features/chat/chat-page.ts`, `.css`, `chat-client.ts` — Preserve the proven chat integration while embedding it as the terminal, initially locked landing section.
- `frontend/src/app/core/content/portfolio-content.ts` — Continue using the validated, shared content bundle so landing and chat facts remain aligned.
- `frontend/src/styles.css` — Formalize the existing navy/emerald values into semantic design tokens and keep reduced-motion behavior global.
- `frontend/src/app/app.spec.ts`, `frontend/src/app/features/portfolio-routes.spec.ts`, `frontend/src/app/features/journey/journey-page.spec.ts`, `frontend/src/app/features/chat/chat-page.spec.ts` — Route/header assumptions must be replaced with strict TDD coverage for continuous landing, unlock, deep links, keyboard flow, and chat reuse.
- `openspec/changes/initial-portfolio-mvp/specs/guided-portfolio-experience/spec.md` — Existing requirements explicitly promise classic navigation and a chat bypass; the new change must deliberately modify those requirements.

### Approaches
1. **Single landing with section fragments and route compatibility redirects** — Make `/` the sole visual composition, use stable section IDs for intro, work, projects, and assistant, and translate legacy paths to their equivalent fragment on the landing.
   - Pros: Meets the continuous-story requirement, supports shareable deep links and browser history, preserves existing content/card/chat investments, and avoids a parallel page system.
   - Cons: Requires explicit focus and scroll-restoration rules; prior route tests and classic-navigation requirements must change.
   - Effort: Medium

2. **Keep separate routes and visually disguise them as sections** — Retain each route while styling transitions to appear continuous.
   - Pros: Smaller initial routing change and preserves existing route tests.
   - Cons: Contradicts the confirmed single-landing/no-separate-pages decision; makes unlock state, back/forward behavior, and assistant persistence brittle.
   - Effort: Medium

3. **Build a new landing beside the current route system and migrate later** — Add a parallel shell and defer retiring the navbar/routes.
   - Pros: Lower immediate regression risk.
   - Cons: Duplicates presentation logic, leaves two information architectures, and delays the central product decision instead of implementing it.
   - Effort: High

### Recommendation
Adopt approach 1. Compose the journey, existing structured content cards, project evidence, and the existing chat component into one semantic landing in mandatory order: **intro/who I am -> experience/work -> projects -> assistant**. Use anchors (for example `#experience`, `#projects`, `#assistant`) as the canonical deep-link contract, update the location with history-safe navigation, and redirect legacy route URLs to the relevant fragment rather than presenting separate views.

Model the assistant lock as explicit client-side journey state: it must not depend on animation completion, scroll timing, or backend state. Completion must be reachable by keyboard and touch as well as scrolling; only then reveal and enable the embedded existing chat. After unlock, show a persistent, accessible “return to assistant” control that stays within the landing. Native Angular/CSS enter/leave motion should cover ordinary reveals; add Motion only if a concrete scroll-linked sequence cannot be expressed accessibly and within the bundle budget. Select Spartan UI components only when they improve a real interaction primitive; do not introduce a second visual system. Evaluate the official Spartan agent skill separately before any installation.

Define semantic tokens from the existing navy/emerald direction (canvas, surface, elevated surface, text, muted text, line, accent, accent-hover, focus) before component work. Keep content hierarchy, spacing, focus, contrast, and mobile reflow intentionally designed rather than using generic landing-page motifs.

### Risks
- The current guided-experience spec and tests promise classic navigation and direct `/chat` bypass; they conflict with the confirmed locked-assistant, single-landing model and must be superseded deliberately in proposal/spec work.
- Fragment navigation must account for Angular router scroll restoration, browser Back/Forward behavior, initial focus, and reduced-motion scrolling; using `scrollIntoView` alone is insufficient.
- A purely in-memory unlock state resets on reload. Product must decide in proposal/spec whether a deep-linked or returning visitor must replay the journey, or whether a deliberately scoped browser-local persistence rule is acceptable.
- The chat’s current `ngAfterViewInit` always focuses its heading. When embedded in a long landing, this must not steal focus on initial landing load; focus should move only after an intentional unlock/assistant navigation.
- Motion, Spartan UI, and extra component styles can exceed the current initial and per-component budgets; performance and `prefers-reduced-motion` must be acceptance criteria, not post-build cleanup.
- The first slice deliberately excludes qualified-contact persistence and notification. The assistant can be the conversion climax visually, but no lead submission may be implied or faked until the later Supabase/Resend slice.

### Ready for Proposal
Yes — the proposal should formally replace the classic multi-route/navigation model with a single accessible landing and define the unlock, fragment/history, focus, mobile, reduced-motion, and first-slice exclusion boundaries. It should explicitly defer Supabase lead storage and Resend notifications, and treat Spartan UI installation plus Motion adoption as evidence-based design choices rather than commitments.