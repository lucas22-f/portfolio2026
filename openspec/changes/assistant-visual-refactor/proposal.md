# Proposal: Assistant Visual Refactor

## Intent

Refine the portfolio assistant into a focused, viewport-contained experience. The assistant should remain centered and usable without page-level scrolling while preserving the established conversational and journey behavior.

## Scope

### In Scope
- Fit the assistant section to `100svh` and prevent outer-page scrolling.
- Center the assistant content within the available viewport.
- Allow only the chat transcript to scroll while keeping the composer persistently available.
- Retain focused regression coverage for chat layout and journey behavior.

### Out of Scope
- Backend, API, transport, or NDJSON stream changes.
- Changes to journey unlock rules or conversational behavior.
- New assistant features, content, or design-system primitives.

## Capabilities

### New Capabilities
None. This is a visual refactor with no new product requirements.

### Modified Capabilities
None. Existing assistant and journey requirements remain unchanged.

## Approach

Restructure the Angular chat and journey page layouts around bounded flex containers: the section owns the viewport height, intermediate containers permit shrinking, and the transcript becomes the sole overflow region. Keep the composer outside that overflow region. Preserve existing tokens, accessibility semantics, NDJSON consumption, and journey unlock logic.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/src/app/features/chat/chat-page.ts` | Modified | Viewport, alignment, transcript overflow, and persistent composer layout. |
| `frontend/src/app/features/chat/chat-page.spec.ts` | Modified | Focused regression expectations for the chat presentation. |
| `frontend/src/app/features/journey/journey-page.ts` | Modified | Assistant section containment within the journey page. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Content clipping on short/mobile viewports | Medium | Use `svh`, shrinkable flex children, and transcript-only overflow. |
| Visual changes accidentally alter behavior | Low | Keep component logic and stream/unlock contracts unchanged; rely on focused tests and build validation. |

## Rollback Plan

Revert the three frontend file changes as one visual work unit. No data migration, backend rollback, or protocol compatibility action is required.

## Dependencies

- Existing Angular layout, design tokens, chat stream client, and journey state.

## Success Criteria

- [ ] The assistant occupies `100svh` with no outer-page scroll.
- [ ] Content remains centered; only the transcript scrolls when messages overflow.
- [ ] The composer stays visible and usable across supported viewport sizes.
- [ ] NDJSON streaming and journey unlock behavior remain unchanged.
- [ ] Focused chat/journey tests and the frontend production build pass.
