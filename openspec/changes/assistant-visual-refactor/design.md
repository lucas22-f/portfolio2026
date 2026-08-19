# Design: Assistant Visual Refactor

## Technical Approach

Keep `ChatPage` as the existing standalone Angular component and change only its template layout. The assistant becomes a three-row, viewport-bound grid: compact header, shrinkable transcript, and persistent composer. An `mx-auto w-full max-w-4xl` wrapper centers that grid within the available viewport while inner transcript and composer content remain centered at `max-w-3xl`. `JourneyPage` owns the enclosing assistant section and prevents it from becoming a second scroll container. Existing `ChatClient`, NDJSON event reduction, journey progress, focus methods, tokens, and Spartan controls remain unchanged.

## Screen Layout and Scroll Ownership

```text
Journey assistant section (`h-svh overflow-hidden`)
└── Chat viewport (`h-svh overflow-hidden`)
    └── Centered max-width grid (`mx-auto w-full max-w-4xl`)
        └── Rows (`auto | minmax(0, 1fr) | auto`)
        ├── Header
        ├── Transcript (`min-h-0 overflow-y-auto overscroll-contain`)
        └── Composer (outside transcript overflow)
```

The browser page and assistant section MUST NOT scroll while the unlocked assistant is active. The transcript is the sole overflow owner. `minmax(0, 1fr)` and `min-h-0` are required so the middle row may shrink instead of expanding the outer page. The composer remains in normal grid flow, not `fixed` or `sticky`, avoiding overlap and safe-area coordination problems.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Use `100svh` through Tailwind `h-svh`. | `100vh`, JS-measured height. | Small viewport units account for mobile browser chrome without runtime measurement. |
| Use one grid with bounded middle row. | Absolute positioning; nested full-height flex columns. | Grid expresses header/transcript/composer ownership directly and keeps the composer visible without overlaying content. |
| Put `overflow-y-auto` only on the transcript. | Scroll the section or whole chat. | Long answers remain reachable while navigation chrome and input stay available. |
| Keep visual state in inline Tailwind classes. | New CSS primitives or component abstractions. | This is a local refactor and the project already uses inline utility composition and existing tokens. |
| Preserve component logic and contracts byte-for-byte where possible. | Rework streaming or journey state alongside layout. | Separates visual risk from behavioral risk and honors the proposal's non-goals. |

## Responsive and Accessibility Behavior

- Mobile uses `px-4`, compact type and vertical spacing; `sm` increases padding and typography without changing layout ownership.
- The transcript keeps `role="log"`, its accessible label, polite live updates, and addition/text relevance.
- The heading remains programmatically focusable for intentional assistant entry.
- The textarea retains a visible focus ring; submit and retry controls retain the `min-h-11` touch target.
- Journey reset/return controls remain keyboard-reachable when the assistant is unlocked, visually appearing on focus rather than consuming viewport space.
- Reduced-motion journey behavior and semantic locked-state reading order remain unchanged.

## Data Flow and Contracts

```text
Composer submit -> existing ChatPage.submit()
  -> ChatClient NDJSON stream -> applyChatEvent()
  -> ChatState signal -> transcript rendering/live announcements

Journey progress -> unlockAssistant() -> ChatPage focusEntry
```

No API, event, state, type, route, or persistence contract changes. Layout test IDs (`chat-viewport`, `chat-transcript`, `chat-composer`) are presentation-level regression hooks only.

## File Changes

| File | Action | Description |
|---|---|---|
| `frontend/src/app/features/chat/chat-page.ts` | Modify | Implement bounded grid, transcript-only overflow, responsive spacing, and persistent composer. |
| `frontend/src/app/features/chat/chat-page.spec.ts` | Modify | Assert viewport, transcript scroller, responsive padding, textarea sizing, and touch target classes while retaining stream/error tests. |
| `frontend/src/app/features/journey/journey-page.ts` | Modify | Make the assistant section viewport-bound and non-scrolling while preserving locked/unlocked behavior and focus controls. |

## Testing Strategy

Strict TDD applies to any further implementation changes: first add or adjust the focused failing assertion, then make the smallest template change, then refactor without behavior changes.

| Layer | What to Test | Approach |
|---|---|---|
| Unit | DOM landmarks, `h-svh`, centered `mx-auto max-w-4xl` wrapper, sole transcript overflow, touch target and responsive utilities. | Scoped Vitest for `chat-page.spec.ts`; retain journey focus/unlock/reset regression coverage in `journey-page.spec.ts`. |
| Behavioral regression | Streaming, safe failure, compatibility, announcements, journey progression. | Existing focused Angular component tests; no new transport mocks or contracts. |
| Build | Angular template and Tailwind utility validity. | Frontend production build after scoped tests pass. |
| Visual | Short/mobile and desktop containment, horizontally centered max-width content, composer visibility, keyboard focus. | Browser inspection at narrow and wide widths confirms balanced side gutters and no outer scroll; no new Playwright requirement for this visual-only slice. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Non-Goals

No backend or NDJSON changes, journey-rule changes, new assistant behavior/content, new design tokens, or reusable layout primitive extraction.

## Migration, Rollout, and Rollback

No migration or feature flag is required. Ship as one visual frontend work unit after focused tests, build, and visual inspection. Roll back by reverting the three frontend files together; no data or protocol recovery is needed.

## Open Questions

None.
