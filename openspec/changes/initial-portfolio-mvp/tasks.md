# Tasks: Initial Portfolio MVP

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 2,500–4,000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Foundation → content/static UI → grounded API → chat integration → E2E/deployment |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Sequential boundary |
|---|---|---|
| 1 | Scaffold toolchains/contracts | PR 1 → main |
| 2 | Publish content/journey | PR 2 → main after PR 1 |
| 3 | Deliver grounded backend | PR 3 → main after PR 2 |
| 4 | Integrate typed chat | PR 4 → main after PR 3 |
| 5 | Prove/deploy MVP | PR 5 → main after PR 4 |

## Phase 1: Foundation and Contracts

- [x] 1.1 Scaffold strict zoneless Angular in `frontend/` with Tailwind, Angular Aria, Vitest/Playwright; scaffold Poetry FastAPI in `backend/` with pytest, lint/type checks, and lockfiles.
- [x] 1.2 Prove runners, then set `openspec/config.yaml` strict TDD/apply commands; later behavior uses RED → GREEN → REFACTOR.
- [x] 1.3 RED/GREEN/REFACTOR `content/v1/{portfolio.schema.json,portfolio.json,reviewed-manifest.json}` plus backend/frontend validators for records, provenance locators, normalized hashes, and identical content-version handshake. [Content: shared facts, missing fields, provenance]

## Phase 2: Accessible Static Experience

- [x] 2.1 RED/GREEN/REFACTOR routes and semantic views under `frontend/src/app/{core,features,shared}/` for profile, experience, education, skills, projects, and project cards. [Content: shared presentation]
- [x] 2.2 RED/GREEN/REFACTOR the progressive journey, persistent classic navigation, terminal `/chat` focus transfer, mobile direct flow, reduced motion, keyboard order, live regions, 44px targets, and accessible `frontend/src/styles.css`. [Journey: all scenarios]

## Phase 3: Grounded Backend

- [x] 3.1 RED/GREEN/REFACTOR `backend/app/domain/` retrieval/safety: Spanish normalization, stable score/top-k, allowed/unsupported/unsafe classification, provenance, thresholds, and limits. [Chat: supported, refusal, limits]
- [x] 3.2 RED/GREEN/REFACTOR `backend/app/application/` candidate validation/hydration: allow-listed parts, atomic claim verification, HTML/unknown-reference rejection, safe mappings, and ordered typed NDJSON events. [Chat: typed/invalid output]
- [ ] 3.3 RED/GREEN/REFACTOR `ChatProvider`/`OpenAIChatProvider` in `backend/app/infrastructure/`; inject model/time/cost limits and fake provider without credentials or prompt/secret logging. [Chat: mocked CI, failures]
- [ ] 3.4 RED/GREEN/REFACTOR FastAPI `/api/v1/chat/stream`, `/metadata`, `/health`, exact CORS origins, and anchored project-scoped preview regex; verify readiness 200/503 and reject unrelated Vercel origins.

## Phase 4: Typed Chat Integration

- [ ] 4.1 RED/GREEN/REFACTOR `frontend/src/app/features/chat/` NDJSON client/state/renderers for allowed parts, refusal/error/retry, sequence handling, and accessible announcements.
- [ ] 4.2 RED/GREEN/REFACTOR metadata compatibility: disable chat on mismatch while static routes remain usable; verify start/done version, model, and usage.

## Phase 5: End-to-End Delivery

- [ ] 5.1 Add mocked Playwright journeys in `frontend/e2e/` for navigation, accessibility, grounded card, refusals/errors, invalid parts, and compatibility disablement.
- [ ] 5.2 Add root-context Vercel configuration for `frontend/` and Railway `backend/Dockerfile` copying `backend/` plus `content/v1`, installing Poetry lock, binding `0.0.0.0:$PORT`, and setting environment-specific API/CORS values.
- [ ] 5.3 Run scoped then full Vitest/pytest/Playwright, builds, content rehash, health/metadata/NDJSON smoke, compatibility/rollback checks; document commands/secrets in root `README.md`.
