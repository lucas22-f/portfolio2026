# Freelance Client Presentation and In-Chat CV Download
Objective: align public portfolio content to the authorized freelance CV, disclose the client name only on a direct chat question, and offer the CV as a chat download action.
Branch: `feat/freelance-client-cv-download`; delivery: `ask-on-risk`; L2 authorizes publication to `main` despite the disclosed Journey UI spec timeout. Focused runners: `backend` Poetry pytest and frontend npm tests/build.

## Specs

### S1 — Freelance and confidential public presentation
The user specified: “no debemos mostrar directamente mercadolibre ya que yo no trabajo internamente, estoy modo freelance para MELI por que trabajo para un equipo pero no quiero auyentar a la gente” and authorized reading the replacement CV at `C:\Users\lucas\Downloads\CV_Lucas_Figueroa09-1.pdf` with “te autorizo”. The public portfolio and downloadable CV must describe Lucas as freelance and anonymize the client. Preserve the source CV's technical experience without claiming internal employment. Checks: public source records, content-derived display, and journey copy contain no client-name disclosure; updated content hashes/contracts validate.

### S2 — Direct chat question about client
The user specified: “si el usuario pregunta, quien era el cliente en el chat bueno ahi si podriamos indicar que es mercadolibre, pero si no no anunciarlo en el sitio verdad ?” Do not announce the client on the public site or by default in chat; a direct chat question about the client's identity may identify Mercado Libre and accurately explain the freelance relationship. Check both the direct-answer path and default/no-intent paths.

### S3 — Download CV from chat
The user requested: “si el usuario pide el cv o quiero el curriculum de lucas, que genere un boton para descargarlo en el mismo chat, estaria buenisimo.” When a visitor clearly asks for Lucas's CV/resume, the chat shows a clearly labeled, accessible download button using the new authorized PDF. The request does not need an AI-generated answer. Checks: recognized requests emit a validated download action and render the button; unrelated/ambiguous requests do not; the button downloads the PDF asset.

## Tasks
- T1 — S1 — inline — done (Journey unit proof unavailable; user directed publication despite the reported timeout) — commit: pending.
- T2 — S2-S3 — delegated — done — commit: pending (combined coherent feature work-unit).
- T3 — S1-S3 — inline verification/integration — in_progress — commit: pending.

### Verification commands (T2)
- From `backend/`: `poetry run pytest tests/test_application_chat.py tests/test_api.py -q`
- From `frontend/`: `npm.cmd test -- --include=src/app/features/chat/chat-page.spec.ts --watch=false`
- From `frontend/`: `npm.cmd test -- --include=src/app/features/chat/chat-client.spec.ts --watch=false`
- Pipe each test command through the loaded `test-output-protocol` filter, preserve the process exit status, and report only failures or the concise pass count. Do not run Playwright.

## Log
- L1 (2026-10-18): “Dale avancemos con esa modificacion, si el usuario pregunta, quien era el cliente en el chat bueno ahi si podriamos indicar que es mercadolibre, pero si no no anunciarlo en el sitio verdad ?, otra cosa, me gustaria agregar la feat de si el usuario pide el cv o quiero el curriculum de lucas, que genere un boton para descargarlo en el mismo chat, estaria buenisimo.”
- Exploration confirmed the old content publicly names “MercadoLibre — Developer / Conversational AI” in `content/v1/portfolio.json` and mentions Mercado Libre in the Journey UI. The authorized new PDF identifies the role as freelance and labels the client “plataforma de e-commerce líder en Latinoamérica (bajo acuerdo de confidencialidad)”; it describes Botmaker, HR/SAP APIs, Python/BigQuery, proprietary cloud, generative-AI migration, MCP servers, and RAG. The prior exact PDF extraction is available in the parent session; workers must not read outside the repository.
- RDD is enabled. Initial `gentle_review assess` before source edits returned medium risk with `reviewDue: false` (reason: under budget). Existing unrelated `.atl/` modifications are preserved and excluded.
- Route evidence: T1 is a coherent source/content/UI data update and will be handled inline. T2 is a separate multi-file chat protocol/UI/download behavior, routed to one bounded writer because the runtime signaled the context backstop; its allowed paths are disjoint from T1. T3 remains parent-owned integration and verification.
- Estimate: under 400 authored changed lines before generated file counts are known; reassess at each work-unit boundary. Commit on this feature branch, then follow the user's later explicit publication instruction in L2.
- T1 implementation: updated the checked-in CV source snapshot and all content hashes from the authorized replacement PDF; anonymized the public portfolio records and Journey copy, retaining the freelance relationship and NDA-safe project details. Backend focused tests passed (public CV content and content-version consistency).
- T1 frontend evidence: added a Journey UI regression test, but its one focused run timed out at 30 seconds during Angular's initial build (`Building...`) before assertions ran. It was not rerun. This proof gap was presented to the user before the L2 instruction to publish.
- T2 started: add deterministic direct-client-identity chat response and an accessible button to download the new PDF in chat; writer must read this document through `## Log` and not access paths outside the repository.
- T2 asset preparation: copied the user-authorized replacement PDF to `frontend/public/downloads/CV_Lucas_Figueroa.pdf`; SHA-256 matches the source snapshot: `1ad0cd41e3f4c6e57cd2938b3b8b53f30671e5f047186e88ea645d55c5091f83`.
- T2 implementation and self-review complete. The direct client identity and CV intents return deterministic validated parts only after safety validation and bypass the provider; the frontend validates a fixed local path and renders an accessible download link. Writer RED/GREEN: backend intent tests and initial frontend type/UI check failed as expected, then all required focused checks passed. Writer results: backend `test_application_chat.py` + `test_api.py` 33 passed; frontend `chat-page.spec.ts` 27 passed; `chat-client.spec.ts` 27 passed. Parent spot check reran the backend pair: 33 passed. No Playwright.
- Native post-writer assess was unassessable because the candidate includes intended-untracked paths; it returned no `reviewDue` continuation. No native review was started. Existing unrelated `.atl/` changes remain excluded.
- T3 verification: backend full suite passed (159 tests); both delegated chat-focused frontend specs passed (27 each); frontend production build passed with the existing initial-bundle budget warning (523.07 kB vs. 500 kB); `git diff --check` passed; public PDF SHA-256 still matches the regenerated CV source.
- T3 blocker before user direction: the focused Journey UI spec timed out after 30 seconds during Angular's initial build, before assertions ran. Per runtime policy it was not retried.
- L2 (2026-10-18): “okey subilo todo a main”. This explicitly authorizes publishing the feature to `main` despite the already-reported Journey test timeout; the missing test proof remains disclosed and no rerun is allowed.
