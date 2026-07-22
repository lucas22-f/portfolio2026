## Exploration: Initial Portfolio MVP

### Current State
The repository is blank apart from SDD metadata. The intended product is a public, evidence-led portfolio with conventional navigation and an informational chat. The planned stack is Angular 22 (standalone, strict, zoneless) and FastAPI/Pydantic managed by Poetry. No runtime, test harness, content schema, design system, or public knowledge corpus exists yet.

The chat is explicitly non-operational: it answers questions about Lucas's public profile, experience, education, skills, and projects. Rich responses should contain typed references such as project cards rather than model-generated HTML. SDD, TDD, subagents, Engram, and Codebase Memory are development practices and portfolio evidence; they are not runtime dependencies or the visitor-facing knowledge store. Every fact explicitly written in `CV_Lucas_Figueroa7-7.pdf` is authorized for public use, including employer references, but the product must not infer or embellish metrics, responsibilities, outcomes, or confidential details that the CV does not state.

### Affected Areas
- `frontend/` (planned) — Angular application shell, classic routes, accessible animated-scroll onboarding, portfolio pages, and full chat UI.
- `backend/` (planned) — FastAPI chat boundary, Pydantic request/response contracts, retrieval, grounding, and safety rules.
- `content/` (planned) — reviewed public source records for profile, experience, education, skills, projects, and evidence links.
- `tests/` (planned) — contract, grounding, accessibility, and end-to-end coverage once runners are installed.
- `openspec/config.yaml` — current stack, testing limitations, and constraints governing later phases.

### Approaches
1. **Static portfolio with guided FAQ** — Render curated pages and deterministic suggested questions entirely in Angular.
   - Pros: smallest deployment surface; lowest cost; predictable and easy to test.
   - Cons: not a genuine open-ended chat; under-demonstrates the intended conversational experience; makes the FastAPI boundary unnecessary.
   - Effort: Low

2. **Structured knowledge API with grounded generation** — Store reviewed portfolio facts as versioned structured content, retrieve a small relevant subset in FastAPI, and have an LLM produce text plus allow-listed typed content references. Angular renders the text and controlled components while classic pages use the same content source.
   - Pros: coherent with the chosen stack; one source of truth for navigation and chat; auditable grounding; supports project cards without arbitrary HTML; can add citations and richer retrieval later.
   - Cons: requires an AI-provider decision, prompt-injection defenses, latency/error UX, and evaluation fixtures; simple first-pass retrieval may miss paraphrases.
   - Effort: Medium

3. **Full RAG platform from day one** — Add embeddings, a vector store, ingestion pipelines, broad observability, and agent/tool infrastructure.
   - Pros: stronger semantic retrieval at larger content volumes; extensible for future documents.
   - Cons: disproportionate infrastructure for a small curated corpus; more cost, failure modes, and privacy review; runtime MCP and agents add no MVP value.
   - Effort: High

### Recommendation
Choose **Structured knowledge API with grounded generation**, but keep the first slice deliberately narrow:

1. Establish one reviewed, versioned content model and seed it with a small public dataset: profile summary, a short skills set, and two sanitized project/experience records.
2. Build a Spanish-only, accessible Angular experience whose animated scroll onboarding teaches the interaction, presents the portfolio evidence, and culminates in the full chat. Classic navigation remains available so visitors never depend on the guided animation to discover core evidence.
3. Expose one FastAPI chat endpoint backed initially by the OpenAI API, with a server-side API key, configurable model, explicit usage/cost limits, and typed Pydantic response parts: `text`, `source`, and `project_cards`. Retrieval should start with deterministic metadata/keyword matching over the small corpus; add embeddings only if evaluation proves recall is inadequate.
4. Constrain generation to facts explicitly present in the approved CV, return an explicit “I do not have verified information” response when evidence is absent, and never expose arbitrary HTML or operational tools. CI must mock the OpenAI boundary so tests remain deterministic and incur no API cost.
5. Validate first with Lucas himself. The MVP succeeds when he can complete the guided journey, reach the chat, and receive a correct CV-grounded answer that renders a project card when relevant.
6. Treat public launch optimization, multilingual support, chat analytics, persistent conversations, authentication, CMS, vector databases, runtime MCP, multi-agent execution, and elaborate carousels as non-goals for the first slice.

This is the smallest slice that validates the actual product proposition: visitors can browse credible evidence conventionally and ask one grounded question that may produce a useful project card. A static FAQ would be cheaper but would not validate the conversational experience; full RAG would build infrastructure before demonstrating demand.

### Risks
- The CV is the public-content boundary, but ingestion or prompting could still introduce unsupported inferences; source records must preserve exact provenance.
- OpenAI model choice and limits must be configurable because pricing, latency, and availability can change independently of product behavior.
- A tiny corpus can make an LLM appear knowledgeable while still producing unsupported synthesis; grounding and refusal tests are essential.
- Scroll-driven animation can harm accessibility, performance, and navigation if it hijacks scrolling; reduced-motion behavior, keyboard access, mobile fallbacks, and direct routes are required.
- The repository has no installed test capability, so strict TDD cannot begin until scaffolding establishes Vitest, pytest, and Playwright.

### Ready for Proposal
Yes — the product question round resolved the proposal gates. The first validator is Lucas; the Spanish-only guided journey ends at the full chat; explicit CV facts define the public knowledge boundary without inference; OpenAI is the initial server-side provider behind configurable limits and mocked CI; and success is completing the journey, reaching chat, and receiving a correct grounded response with a project card when relevant.
