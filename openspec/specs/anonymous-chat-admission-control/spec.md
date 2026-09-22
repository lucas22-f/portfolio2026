# Anonymous Chat Admission Control Specification

## Purpose

Define a bounded, process-local admission boundary for anonymous streaming chat that limits frequency and concurrency before provider work, returns safe retryable outcomes, and releases all temporary admission state without adding shared infrastructure or changing the existing chat content and provider-cost contract.

## Requirements

### Requirement: Bounded anonymous chat admission

The backend MUST apply a process-local admission policy to anonymous chat streams before provider or graph work begins. The policy MUST allow no more than 10 admissions per 60-second window for one transport peer, no more than 2 simultaneous streams for one transport peer, and no more than 32 simultaneous streams in one process. The limits MUST be configurable only within bounded safety constraints, with these values as the defaults.

#### Scenario: A peer within the baseline is admitted

- GIVEN a transport peer has made fewer than 10 admissions in the preceding 60 seconds
- AND the peer has fewer than 2 active anonymous chat streams
- AND the process has fewer than 32 active anonymous chat streams
- WHEN the peer starts an anonymous chat stream
- THEN the backend MUST admit the stream
- AND the backend MUST allow the existing chat processing path to continue

#### Scenario: Frequency limit rejects the next admission

- GIVEN a transport peer has already made 10 admissions in the current 60-second window
- WHEN the peer starts another anonymous chat stream
- THEN the backend MUST reject the admission before provider or graph work
- AND the backend MUST return the stable throttled outcome defined by this capability

#### Scenario: Per-peer concurrency limit rejects an additional stream

- GIVEN a transport peer already has 2 active anonymous chat streams
- AND the process has available global stream capacity
- WHEN the peer starts another anonymous chat stream
- THEN the backend MUST reject the admission before provider or graph work
- AND existing active streams MUST remain unaffected

#### Scenario: Process concurrency limit rejects an additional stream

- GIVEN the process already has 32 active anonymous chat streams
- AND the requesting peer has not exceeded its per-peer limits
- WHEN the peer starts another anonymous chat stream
- THEN the backend MUST reject the admission before provider or graph work
- AND the rejection MUST not start provider or graph work

### Requirement: Transport-peer identity is authoritative

The admission policy MUST identify a caller using the request transport peer supplied by the server boundary. It MUST use `request.client.host` or its equivalent authoritative transport-peer value and MUST NOT trust `X-Forwarded-For`, `Forwarded`, or similar client-supplied headers while no trusted-proxy boundary is configured. The policy MUST remain process-local and MUST NOT require Redis, a shared store, a gateway, a WAF, or another external coordination service.

#### Scenario: Forwarded headers cannot bypass the peer limit

- GIVEN two requests arrive from the same transport peer
- AND the requests contain different client-supplied forwarded-IP header values
- WHEN the requests are evaluated for admission
- THEN the backend MUST treat them as the same peer for admission purposes
- AND the forwarded header values MUST NOT be used as admission identity

#### Scenario: Different transport peers have independent peer limits

- GIVEN two requests arrive with different authoritative transport-peer values
- WHEN both requests are evaluated for admission
- THEN each peer MUST be evaluated against its own peer frequency and concurrency state
- AND neither peer's client-supplied forwarded-IP headers MUST alter that identity

#### Scenario: Process-local scope is explicit

- GIVEN the service runs in one process without a shared admission service
- WHEN an anonymous chat request is evaluated
- THEN the backend MUST enforce the configured limits using only process-local state
- AND the contract MUST NOT imply coordination across processes, replicas, or restarts

### Requirement: Admission rejection has safe retry semantics

The backend MUST return a stable, retryable throttled outcome when admission rejects an anonymous chat request. The outcome MUST provide bounded retry guidance, MUST NOT expose internal counters or provider details, and MUST NOT include request content or personal data. Admission rejection MUST occur before readiness checks, retriever/provider work, or creation of streaming graph work.

#### Scenario: Throttled request receives bounded retry guidance

- GIVEN an anonymous chat request exceeds a frequency or concurrency limit
- WHEN the backend rejects the request
- THEN it MUST return the stable throttled outcome
- AND it MUST communicate bounded retry guidance
- AND it MUST omit request payload, prompt content, peer identity, internal counters, and provider diagnostics

#### Scenario: Admission rejection does not invoke provider work

- GIVEN an anonymous chat request is rejected by the admission policy
- WHEN the backend completes the rejection
- THEN no readiness, retriever, model, token, or cost-processing work MUST be started for that request
- AND no streaming graph task MUST be created for that request

#### Scenario: Accepted requests preserve existing provider ceilings

- GIVEN an anonymous chat request passes admission
- WHEN the existing chat provider path processes the stream
- THEN the existing model, token, timeout, projected-cost, and actual-cost ceilings MUST remain unchanged
- AND admission control MUST NOT be treated as a replacement for those per-request ceilings

### Requirement: Admission state is cleaned up and bounded

The backend MUST release a stream's in-flight admission state on every terminal stream path, including normal completion, client cancellation, provider failure, and internal failure. Frequency and identity state MUST expire or be bounded so abandoned activity cannot permanently consume capacity. Admission lifecycle diagnostics MAY record category-only non-PII metadata but MUST NOT record request payloads or chat content.

#### Scenario: Normal stream completion releases capacity

- GIVEN an anonymous chat stream was admitted and completes normally
- WHEN the stream reaches its terminal outcome
- THEN its in-flight admission state MUST be released
- AND a later request MUST be able to use the released per-peer and process capacity

#### Scenario: Cancelled stream releases capacity

- GIVEN an anonymous chat stream was admitted
- WHEN the client disconnects or cancels the stream before normal completion
- THEN its in-flight admission state MUST be released
- AND the cancellation MUST NOT permanently consume peer or process capacity

#### Scenario: Failed stream releases capacity

- GIVEN an anonymous chat stream was admitted
- WHEN provider work or internal stream processing fails
- THEN its in-flight admission state MUST be released
- AND the failure MUST not leave an unbounded active-stream entry

#### Scenario: Expired state does not grow without bound

- GIVEN peer admission records have passed their configured validity window or the configured state capacity is reached
- WHEN the backend performs admission bookkeeping
- THEN expired or excess state MUST be removed or safely bounded
- AND the backend MUST NOT retain chat content or raw request payloads as admission state

#### Scenario: Admission logs remain category-only

- GIVEN an admission is accepted, rejected, released, or cleaned up
- WHEN the backend records an operational diagnostic
- THEN the diagnostic MAY include a bounded event category and outcome
- AND it MUST NOT include request payloads, prompts, chat content, or personal data

### Requirement: Admission configuration fails safely

The service MUST validate admission configuration before using it. Invalid, non-positive, or unbounded values MUST NOT silently disable admission or create unbounded state. The configured baseline MUST be usable without any new runtime dependency or shared infrastructure.

#### Scenario: Baseline defaults are available without extra infrastructure

- GIVEN no admission override is supplied
- WHEN the service starts and an anonymous chat request is evaluated
- THEN it MUST use the 10-per-60-seconds, 2-per-peer, and 32-per-process baseline
- AND it MUST not require Redis, a shared store, a WAF, CAPTCHA, Turnstile, accounts, or login

#### Scenario: Invalid admission configuration is rejected safely

- GIVEN an admission limit or window is missing, non-positive, outside an approved safety bound, or otherwise invalid
- WHEN the service validates its configuration
- THEN it MUST fail closed or refuse to serve the affected chat boundary
- AND it MUST not fall back to an unbounded or disabled admission policy
- AND it MUST not expose configuration secrets or request content
