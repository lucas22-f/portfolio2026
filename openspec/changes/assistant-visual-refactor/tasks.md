# Tasks: Assistant Visual Refactor

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 280–340 authored lines (three frontend files, including focused tests) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single visual frontend work unit |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Close visual verification and delivery evidence | Single PR | `cd frontend; npm test -- --include=src/app/features/chat/chat-page.spec.ts --watch=false` plus `npm run build` (already passed) | `npm run start -- --host 127.0.0.1`; inspect narrow and desktop viewports, transcript scroll, composer, and keyboard focus | Revert `frontend/src/app/features/chat/chat-page.ts`, `frontend/src/app/features/chat/chat-page.spec.ts`, and `frontend/src/app/features/journey/journey-page.ts` together |

## Phase 1: Implemented Layout Work (completed in working tree)

- [x] 1.1 Confirm `chat-page.ts` uses `h-svh`, centered `max-w-4xl`, `grid-rows-[auto_minmax(0,1fr)_auto]`, and keeps the composer outside transcript overflow.
- [x] 1.2 Confirm `journey-page.ts` makes the unlocked assistant section `h-svh overflow-hidden` without changing stream, unlock, reset, or focus logic.

## Phase 2: Regression Proof (completed in working tree)

- [x] 2.1 Confirm `chat-page.spec.ts` covers viewport landmarks, responsive classes, touch targets, and `overflow-y-auto` transcript ownership.
- [x] 2.2 Preserve existing streaming, compatibility, announcement, and journey regression coverage; focused frontend tests and `npm run build` have passed.

## Phase 3: Browser Verification and Delivery Preparation

- [x] 3.1 Inspect the running assistant at narrow/mobile and desktop widths: no page or section scroll, transcript is the sole scroller, composer stays visible, gutters remain centered, and focus states are keyboard reachable.
- [x] 3.2 Record browser observations and attach focused test/build evidence for `sdd-verify`; do not modify `.atl/skill-registry.md` or `.atl/.skill-registry.cache.json`.
- [ ] 3.3 Before PR creation, confirm an approved issue, exactly one `type:*` label, conventional commit text, and a PR body listing the three frontend files and verification results; stage no user-owned `.atl` changes.

## Key Learnings

1. The implementation is already present, so remaining work is browser proof and delivery evidence rather than new frontend coding.
2. The visual slice stays below the 400-line review budget and is intentionally one reversible work unit.
