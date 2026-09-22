# Delta for Contact Email Delivery

## MODIFIED Requirements

### Requirement: Proportionate anti-abuse and bounded processing

The submission boundary MUST apply server-side controls that bound request size, request frequency, and delivery work. Controls MUST fail closed for malformed or abusive traffic without relying solely on client validation, and they MUST avoid storing contact content as an abuse-control artifact. The contact rate guard MUST remain process-local and MUST use an HMAC-derived, non-PII identity based on the authoritative transport peer; it MUST NOT trust `X-Forwarded-For`, `Forwarded`, or similar forwarded-IP headers without a documented trusted-proxy boundary. Its default frequency limit MUST remain 5 attempts per 600 seconds, and its abuse-control state MUST have a bounded capacity of 2,000 entries.
(Previously: The requirement defined general server-side size, frequency, delivery-work, fail-closed, and non-content-storage controls without specifying the contact guard's process scope, HMAC identity, transport-peer source, or default bounds.)

#### Scenario: Excessive request rate is throttled

- GIVEN a caller exceeds the configured submission frequency or abuse threshold
- WHEN another submission is received
- THEN the backend MUST reject or defer the request without invoking Brevo delivery
- AND it MUST return a safe retryable or throttled outcome
- AND the response MUST not reveal sensitive rate-limit state or personal data

#### Scenario: The contact baseline retains its current frequency default

- GIVEN a caller has made 5 contact attempts within the preceding 600 seconds according to the process-local HMAC-derived abuse identity
- WHEN another otherwise valid submission is received
- THEN the backend MUST reject it before invoking Brevo delivery
- AND it MUST return a safe throttled or retryable outcome
- AND the limit MUST be evaluated using the authoritative transport peer rather than a forwarded-IP header

#### Scenario: Malformed traffic cannot consume delivery quota

- GIVEN a request has an invalid content type, invalid contract shape, impossible field encoding, or oversized payload
- WHEN the request is processed
- THEN the backend MUST reject it before invoking Brevo delivery
- AND the rejection MUST not consume a delivery attempt

#### Scenario: Abuse-control state is bounded and non-PII

- GIVEN the service uses short-lived state for throttling or duplicate protection
- WHEN that state is created or expired
- THEN it MUST be bounded in lifetime and size
- AND it MUST use non-PII identifiers or derived request metadata
- AND it MUST NOT become a submission archive or message store

#### Scenario: Contact rate state reaches its capacity safely

- GIVEN process-local contact abuse-control state contains 2,000 entries
- WHEN another request requires abuse-control state
- THEN the backend MUST keep the state bounded and apply a safe deterministic admission outcome
- AND it MUST NOT store raw email addresses, message text, or request bodies to make room

### Requirement: Duplicate and idempotent submission handling

The backend MUST support a bounded idempotency or duplicate-handling contract so that a visitor retry, browser replay, or network ambiguity cannot cause the same logical submission to be delivered repeatedly. Duplicate outcomes MUST be distinguishable from new delivery and MUST not require retaining the submitted message as persistent data. The idempotency identity and state MUST remain process-local, MUST use an HMAC-derived non-PII representation, MUST expire after the default 900-second TTL, and MUST have a bounded capacity of 2,000 entries. The contract MUST NOT imply duplicate coordination across processes, replicas, or restarts.
(Previously: The requirement required bounded duplicate handling but did not state the HMAC-only process-local scope, 900-second default TTL, 2,000-entry capacity, or absence of cross-process coordination.)

#### Scenario: First request creates one delivery attempt

- GIVEN a valid request has a new supported idempotency identity
- WHEN the backend processes it
- THEN it MUST make at most one delivery attempt for that identity
- AND it MUST return the resulting accepted, retryable, or rejected outcome

#### Scenario: Replay of an accepted request does not resend

- GIVEN a logical submission identity has already been accepted by the Brevo transactional email API
- WHEN the same identity is submitted again within the 900-second duplicate-protection window
- THEN the backend MUST NOT invoke Brevo delivery a second time
- AND it MUST return a duplicate or already-accepted outcome that the client can present as completion

#### Scenario: Ambiguous delivery can be retried safely

- GIVEN the client did not receive the result of a request and the backend cannot prove that delivery was accepted
- WHEN the client retries with the same logical identity
- THEN the backend MUST use the identity to prevent unsafe duplicate delivery where possible
- AND it MUST return a bounded retryable or duplicate outcome rather than claiming success without evidence

#### Scenario: Expired idempotency state does not become a submission archive

- GIVEN an idempotency identity is older than the 900-second default TTL
- WHEN the backend evaluates a later request
- THEN the expired identity MAY be eligible for a new bounded evaluation
- AND the backend MUST NOT retain the submitted message or personal fields as the expired state

#### Scenario: Idempotency state remains bounded at capacity

- GIVEN process-local idempotency state contains 2,000 entries
- WHEN another valid request requires an idempotency entry
- THEN the backend MUST keep state within the configured capacity
- AND it MUST return a safe bounded outcome if it cannot establish duplicate protection
- AND it MUST NOT claim delivery succeeded without evidence

### Requirement: Stable outcome and configuration semantics

The submission contract MUST expose stable, non-sensitive outcome categories for success, validation failure, throttling, duplicate/already accepted, retryable delivery failure, non-retryable failure, and unavailable configuration. The backend MUST distinguish service configuration failure from visitor input failure. Invalid contact rate or idempotency guard configuration MUST fail closed before delivery rather than silently disabling protection or creating unbounded state.
(Previously: The requirement defined stable outcome categories and distinguished service configuration from visitor input, but did not make invalid abuse-guard configuration fail closed.)

#### Scenario: Brevo acceptance returns success

- GIVEN validation and abuse checks pass
- AND the Brevo transactional email API accepts the outbound message
- WHEN the backend completes processing
- THEN it MUST return a success category that the client can render as delivered

#### Scenario: Transient Brevo failure returns retryable failure

- GIVEN Brevo is temporarily unavailable, the network request fails transiently, or the Brevo API returns HTTP 408, 429, or 5xx
- WHEN the backend completes processing
- THEN it MUST return a retryable failure category
- AND it MUST not expose raw provider response data
- AND it MUST leave the client able to retry under the duplicate contract

#### Scenario: Brevo request timeout returns an uncertain failure

- GIVEN the request to Brevo times out while attempting delivery
- WHEN the backend completes processing
- THEN it MUST return an uncertain failure category
- AND it MUST not expose provider response text or raw Brevo response data
- AND it MUST prevent an automatic replay from claiming or causing a known-safe duplicate delivery

#### Scenario: Permanent or invalid Brevo failure returns non-retryable failure

- GIVEN Brevo rejects authentication, the configured sender or recipient, or the request for another permanent reason
- WHEN the backend completes processing
- THEN it MUST return a non-retryable failure category
- AND it MUST not report that the message was delivered

#### Scenario: Missing or invalid configuration fails safely

- GIVEN `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_RECIPIENT_EMAIL`, or another required delivery configuration is absent or invalid
- WHEN a valid contact request reaches the submission boundary
- THEN the backend MUST refuse delivery
- AND it MUST return an unavailable or configuration-failure category
- AND it MUST not reveal which secret or configuration value is missing

#### Scenario: Invalid abuse-guard configuration fails closed

- GIVEN the contact rate or idempotency configuration is missing, non-positive, outside an approved safety bound, or otherwise invalid
- WHEN the service validates configuration or receives a contact request
- THEN it MUST refuse delivery rather than disable the guard or use unbounded state
- AND it MUST return or record only a stable unavailable or configuration-failure category
- AND it MUST not include secrets, request bodies, or contact values in the outcome

## ADDED Requirements

### Requirement: Contact guard scope is documented without widening the public contract

The contact protection contract MUST document that its HMAC-derived rate and idempotency state is process-local and keyed from the authoritative transport peer, while forwarded client-IP headers remain untrusted unless a future deployment explicitly establishes a trusted proxy boundary. This clarification MUST NOT add fields, persistence, authentication, or a frontend/mobile dependency to the contact submission contract.

#### Scenario: Transport-peer identity remains the documented boundary

- GIVEN a contact request includes a client-supplied `X-Forwarded-For`, `Forwarded`, or similar header
- WHEN the contact guard derives its abuse or duplicate identity
- THEN it MUST use the authoritative transport peer
- AND it MUST ignore the forwarded header for identity purposes

#### Scenario: Contact protection remains process-local

- GIVEN the contact service runs in one process without a shared abuse-control store
- WHEN a contact request is evaluated
- THEN the backend MUST apply its configured local HMAC-derived guards
- AND the contract MUST NOT claim coordination across processes, replicas, or restarts
- AND no Redis, WAF, CAPTCHA, account, login, frontend, or mobile dependency MUST be required
