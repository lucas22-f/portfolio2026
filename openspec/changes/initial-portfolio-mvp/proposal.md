# Proposal: Initial Portfolio MVP

## Intent

Deliver a Spanish-only, evidence-led portfolio that Lucas can validate end to end. Visitors learn the interaction through progressive scroll, retain conventional navigation, and finish at an informational chat whose answers are limited to facts explicitly stated in `CV_Lucas_Figueroa7-7.pdf`.

## Scope

### In Scope
- Accessible Angular portfolio with classic routes and a reduced-motion/mobile-safe guided journey ending at the full chat.
- Reviewed, versioned public content for profile, experience, education, skills, and projects, with CV provenance.
- FastAPI chat endpoint using OpenAI server-side, deterministic retrieval, refusals for unsupported questions, typed text/source/project-card parts, configurable model and cost controls, and mocked CI.

### Out of Scope
- Runtime MCP, embeddings/vector database, operational tools, authentication, CMS, persistent chat, multi-agent runtime, analytics, or i18n.
- Facts inferred beyond the approved CV and arbitrary model-generated HTML.

## Capabilities

### New Capabilities
- `guided-portfolio-experience`: Accessible progressive-scroll onboarding, responsive evidence presentation, and always-usable classic navigation.
- `public-portfolio-content`: Reviewed Spanish portfolio records with explicit CV provenance and reusable structured data.
- `grounded-portfolio-chat`: Informational chat constrained to approved evidence, with typed sources/project cards, safe refusals, and provider cost controls.

### Modified Capabilities
- None.

## Approach

Build an Angular 22 standalone, strict, zoneless frontend with Tailwind and Angular Aria. Share reviewed structured content between conventional pages and a FastAPI/Pydantic boundary. Retrieve a small evidence subset with deterministic metadata/keyword matching, then ask a configurable OpenAI model to produce allow-listed typed parts. Keep the API key server-side and mock the provider in CI.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `frontend/` | New | Routes, onboarding motion, portfolio views, chat UI, accessibility states. |
| `backend/` | New | Chat contract, retrieval, grounding, refusal, provider controls. |
| `content/` | New | Reviewed CV-derived records and provenance. |
| `tests/` | New | Contracts, grounding, accessibility, and guided-journey coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Unsupported synthesis | Medium | Provenance, constrained context, refusal and grounding tests. |
| Motion harms access/performance | Medium | Reduced motion, keyboard support, mobile fallback, direct routes. |
| Provider cost/availability changes | Medium | Configurable model/limits, timeouts, error UX, mocked CI. |

## Rollback Plan

Disable the chat and guided-animation entry points while preserving static routes and reviewed content; revert frontend/backend deployments independently. No user data migration is required.

## Dependencies

- Angular/FastAPI scaffolding and test runners; approved CV extraction; OpenAI API credentials and deployment secrets.

## Success Criteria

- [ ] Lucas completes the guided journey and reaches the full chat without losing classic navigation.
- [ ] A relevant question returns a correct CV-grounded Spanish answer and can render a project card.
- [ ] Unsupported questions refuse safely; reduced-motion and mocked-CI paths pass.
