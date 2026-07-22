# Design: Initial Portfolio MVP

## Technical Approach

The repository has only SDD metadata. Build a greenfield Angular/FastAPI monorepo. Reviewed versioned JSON supplies pages, retrieval, sources, and hydrated chat parts; both deployments build from repository-root context.

## Architecture Decisions

| Decision | Alternative / tradeoff | Choice and rationale |
|---|---|---|
| Boundaries | Duplication drifts. | Root `frontend/`, `backend/`, `content/v1/`; apps own toolchains and validate identical content hashes. |
| Frontend | RxJS adds machinery. | Angular 22 standalone, strict, zoneless; Signals, Angular Aria, Tailwind. |
| Retrieval | Embeddings add infrastructure/nondeterminism. | Normalize Spanish input; score tokens/aliases; stable top-k by score then ID; below-threshold refuses. |
| Grounding | Free-form facts are unprovable. | Provider returns candidate allow-listed typed parts with approved references. Server validates references, hydrates factual fields, and verifies atomic claims before final emission. |
| Provider | Route calls leak vendor details. | `ChatProvider`/`OpenAIChatProvider`; startup-validated environment model is injected. Tests configure a fake model/provider implementing candidate parts. |
| Transport | WebSockets are unnecessary. | `POST /api/v1/chat/stream` returns ordered NDJSON. |
| Rendering | Markdown/HTML is unsafe. | Pydantic accepts only `text`, `source`, and exact `project-card`; invalid parts never reach rendering. |

## Data Flow

```text
page -> content/v1 -> reviewed evidence
chat -> limits -> safety -> retrieval -> provider candidates -> hydrate/verify -> NDJSON
```

Requests classify `allowed`, `unsupported`, or `unsafe` before provider invocation. Unsafe emits Spanish `unsafe-request`; no evidence emits `unsupported-request`; only allowed reaches OpenAI.

The semantic journey enhances with `IntersectionObserver`. Its terminal CTA navigates to full `/chat`, then accessibly focuses the chat heading or composer. Classic routes remain usable. Reduced motion, live regions, 44px targets, keyboard support, and motion-independent information are mandatory; mobile defaults to direct flow.

## File Changes

| Path | Action | Responsibility |
|---|---|---|
| `frontend/src/app/{core,features,shared}/`, `frontend/src/styles.css` | Create | Routes, journey, views, typed chat, accessible theme. |
| `backend/{app/{api,application,domain,infrastructure},Dockerfile}` | Create | API layers and portable container. |
| `content/v1/{portfolio.json,portfolio.schema.json,reviewed-manifest.json}` | Create | Claims, factual fields, provenance. |
| `backend/tests/`, `frontend/src/**/*.spec.ts`, `frontend/e2e/` | Create | Test layers. |

## Interfaces / Contracts

Records use `{id, kind, title, claims[], tags[], aliases[], project?, provenance[]}`; claims use `{claim_id,text,provenance_id}`. Manifest entries map `{provenance_id,source_id,source_sha256,page,normalized_start,normalized_end,excerpt_sha256,reviewed_at,reviewer}`. Hashing applies Unicode NFC, LF endings, trimmed edges and single spaces, then UTF-8 SHA-256s the indexed page slice. CI resolves and rehashes each locator.

Request: `{message,locale:"es",client_request_id}`. NDJSON events share `{request_id,sequence}` and are `start`, `part`, `refusal`, `error`, `done`. `ChatProvider.generate` returns candidate `text`, `source`, or `project-card` parts carrying `record_ids[]`/`claim_ids[]`; mocks target it. Server rejects unknown references, verifies claims, ignores provider factual display fields, and hydrates final `{type:"text",text,record_ids[],claim_ids[]}`, `{type:"source",record_id,label}`, or `{type:"project-card",record_id,title,summary,links}`.

Refusal/error payloads are `{code,message,retryable}`. `unsafe-request`/`unsupported-request` are Spanish, non-retryable refusals. Invalid schema/references/HTML/claims emit `error:{code:"invalid-provider-output",message:"No pude validar la respuesta.",retryable:false}`. Preflight limit failure emits `error:{code:"limit-exceeded",message:"La solicitud supera el límite permitido.",retryable:false}`, closes, and never calls the provider. A midstream cap cancels the provider, discards unvalidated candidates, emits that event once, then closes without `done`. Provider failures have distinct Spanish mappings.

Frontend embeds expected `content_version` and hash. Backend exposes them via `/metadata` and stream `start`. Mismatch disables chat with `El chat no está disponible temporalmente.` while static/classic content remains usable; promotion checks reject incompatible pairs. `done` includes version, model, usage.

## Cost, Deployment, and Readiness

Limits cap input, retrieval, output, duration, and cost; logs exclude secrets/prompts. Vercel uses repository-root build context; project/build configuration builds `frontend/` and its output while including `content/v1`. Environment-specific `API_BASE_URL` targets Railway. Railway also uses repo-root context with `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile`; Docker `COPY` explicitly packages `backend/` plus `content/v1`, installs Poetry-locked dependencies, and binds `0.0.0.0:$PORT`. Only Railway stores OpenAI secrets; the OCI image remains portable.

CORS uses exact configured local/production origins plus an anchored, project-scoped `CORS_PREVIEW_ORIGIN_REGEX` for this portfolio's Vercel previews; never `*.vercel.app`. Tests reject unrelated origins.

`/health` returns secret-free `200 {status,app_version,content_version}` only after configuration, content, and provider-adapter initialization validate without calling OpenAI; otherwise `503`. Pytest and deployment smoke checks cover both states. Preview/production promotion and rollback remain independent, subject to the compatibility check.

## Testing Strategy

Vitest covers Signals, routes, focus/motion, version mismatch, discriminators, refusal/error rendering. Pytest covers provenance, retrieval, safety, candidate hydration, limit/provider mappings, CORS, readiness, and NDJSON order. Playwright covers guided/classic accessibility, grounded/refusal/error flows, compatibility disablement, and mocked candidate parts.

## Migration / Rollout

No migration. Deploy static routes first; enable chat after health, compatibility, and contract checks.

## Open Questions

None.
