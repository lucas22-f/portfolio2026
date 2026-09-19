# Contact Email Delivery Specification

## Purpose

Define the FastAPI-owned contact submission boundary that validates the four-field form, applies bounded abuse and duplicate protection, delivers accepted submissions through Gmail SMTP, and never persists or exposes submitted personal data outside the delivery operation.

## Requirements

### Requirement: Dedicated validated submission boundary

The backend MUST expose a dedicated, versioned submission contract for contact messages. It MUST accept only the declared contact fields and the metadata required to enforce the submission contract; it MUST reject unknown, missing, malformed, or oversized input before delivery.

#### Scenario: Valid contact submission is accepted for delivery

- GIVEN a request uses a supported submission contract version
- AND name, email, company according to its requiredness contract, and message satisfy the published format and length limits
- AND the request passes abuse and duplicate checks
- WHEN the backend processes the request
- THEN it MUST attempt delivery through the configured Gmail SMTP integration
- AND it MUST return a stable success outcome only after Gmail SMTP accepts the message for delivery

#### Scenario: Unknown fields are rejected

- GIVEN a request contains fields outside the supported contact contract
- WHEN the backend validates the request
- THEN it MUST reject the request without calling Gmail SMTP
- AND the response MUST identify a safe validation category without returning submitted PII

#### Scenario: Missing or malformed values are rejected server-side

- GIVEN a request omits a required field or contains an invalid email, invalid text value, or value outside the declared bounds
- WHEN the backend validates the request
- THEN it MUST return a validation outcome
- AND it MUST not call Gmail SMTP
- AND it MUST not persist the rejected values

#### Scenario: Oversized request is bounded before processing

- GIVEN the request body, an individual field, or the aggregate declared payload exceeds its limit
- WHEN the backend receives the request
- THEN it MUST reject the request before delivery
- AND it MUST return a bounded error response
- AND it MUST not include the oversized value in logs or diagnostics

### Requirement: Non-persistent Gmail SMTP delivery

The backend MUST deliver accepted contact submissions directly to the authenticated Gmail address over SMTP using backend-only configuration. It MUST use that Gmail address as both sender and recipient and the validated visitor email as the Reply-To address. It MUST NOT persist submissions, create an inbox or database record, or retain message content beyond the minimum transient processing required to complete the request.

#### Scenario: Accepted submission is delivered without application persistence

- GIVEN a valid, non-duplicate request and an available Gmail SMTP configuration
- WHEN Gmail SMTP accepts the outbound message
- THEN the backend MUST return a success outcome
- AND no contact submission record, draft, or message body MUST be written to application persistence

#### Scenario: Gmail SMTP credentials remain backend-only

- GIVEN the contact-delivery service is configured
- WHEN the frontend receives form configuration or a submission response
- THEN no Gmail address, app password, or provider credential MUST be present in the response, chat event, or browser-visible configuration

#### Scenario: Delivery failure does not create a partial local record

- GIVEN Gmail SMTP rejects, times out, or is unavailable while processing a request
- WHEN the backend returns the failure outcome
- THEN no local submission record MUST be created
- AND the response MUST classify the failure as retryable or non-retryable without exposing provider response content

### Requirement: Server-side privacy boundary

Submitted name, email, company, and message values MUST be excluded from model prompts, provider inputs unrelated to email delivery, chat SSE events, application logs, error details, metrics labels, traces, and standard observability payloads. The backend MAY record non-PII operational metadata needed to operate the service.

#### Scenario: Contact values are isolated from chat generation

- GIVEN a visitor submits a contact form from an existing chat conversation
- WHEN the backend validates and delivers the request
- THEN the submitted values MUST NOT be added to the chat graph state or any model/provider prompt
- AND the chat conversation MUST not be resumed with the submitted values as assistant context

#### Scenario: Contact values are absent from delivery responses and SSE

- GIVEN the submission succeeds or fails
- WHEN the backend returns the result and any concurrent chat stream continues
- THEN response bodies and SSE events MUST contain only stable status categories, request correlation data, and safe non-PII metadata
- AND they MUST NOT contain any submitted field value

#### Scenario: Operational diagnostics are redacted

- GIVEN validation, abuse, duplicate, configuration, or Gmail SMTP failures occur
- WHEN the backend records operational diagnostics
- THEN logs, metrics, and traces MUST use redacted categories and bounded metadata
- AND they MUST NOT include request bodies, email addresses, message text, provider payloads, or secrets

### Requirement: Proportionate anti-abuse and bounded processing

The submission boundary MUST apply server-side controls that bound request size, request frequency, and delivery work. Controls MUST fail closed for malformed or abusive traffic without relying solely on client validation, and they MUST avoid storing contact content as an abuse-control artifact.

#### Scenario: Excessive request rate is throttled

- GIVEN a caller exceeds the configured submission frequency or abuse threshold
- WHEN another submission is received
- THEN the backend MUST reject or defer the request without calling Gmail SMTP
- AND it MUST return a safe retryable or throttled outcome
- AND the response MUST not reveal sensitive rate-limit state or personal data

#### Scenario: Malformed traffic cannot consume delivery quota

- GIVEN a request has an invalid content type, invalid contract shape, impossible field encoding, or oversized payload
- WHEN the request is processed
- THEN the backend MUST reject it before invoking Gmail SMTP
- AND the rejection MUST not consume a delivery attempt

#### Scenario: Abuse-control state is bounded and non-PII

- GIVEN the service uses short-lived state for throttling or duplicate protection
- WHEN that state is created or expired
- THEN it MUST be bounded in lifetime and size
- AND it MUST use non-PII identifiers or derived request metadata
- AND it MUST NOT become a submission archive or message store

### Requirement: Duplicate and idempotent submission handling

The backend MUST support a bounded idempotency or duplicate-handling contract so that a visitor retry, browser replay, or network ambiguity cannot cause the same logical submission to be delivered repeatedly. Duplicate outcomes MUST be distinguishable from new delivery and MUST not require retaining the submitted message as persistent data.

#### Scenario: First request creates one delivery attempt

- GIVEN a valid request has a new supported idempotency identity
- WHEN the backend processes it
- THEN it MUST make at most one delivery attempt for that identity
- AND it MUST return the resulting accepted, retryable, or rejected outcome

#### Scenario: Replay of an accepted request does not resend

- GIVEN a logical submission identity has already been accepted by Gmail SMTP
- WHEN the same identity is submitted again within the duplicate-protection window
- THEN the backend MUST NOT call Gmail SMTP a second time
- AND it MUST return a duplicate or already-accepted outcome that the client can present as completion

#### Scenario: Ambiguous delivery can be retried safely

- GIVEN the client did not receive the result of a request and the backend cannot prove that delivery was accepted
- WHEN the client retries with the same logical identity
- THEN the backend MUST use the identity to prevent unsafe duplicate delivery where possible
- AND it MUST return a bounded retryable or duplicate outcome rather than claiming success without evidence

### Requirement: Stable outcome and configuration semantics

The submission contract MUST expose stable, non-sensitive outcome categories for success, validation failure, throttling, duplicate/already accepted, retryable delivery failure, non-retryable failure, and unavailable configuration. The backend MUST distinguish service configuration failure from visitor input failure.

#### Scenario: Gmail SMTP acceptance returns success

- GIVEN validation and abuse checks pass
- AND Gmail SMTP accepts the outbound message
- WHEN the backend completes processing
- THEN it MUST return a success category that the client can render as delivered

#### Scenario: Transient provider failure returns retryable failure

- GIVEN Gmail SMTP is temporarily unavailable or returns a transient 4xx failure
- WHEN the backend completes processing
- THEN it MUST return a retryable failure category
- AND it MUST not expose raw provider response data
- AND it MUST leave the client able to retry under the duplicate contract

#### Scenario: SMTP timeout returns an uncertain failure

- GIVEN Gmail SMTP times out while attempting delivery
- WHEN the backend completes processing
- THEN it MUST return an uncertain failure category
- AND it MUST not expose SMTP server text or raw provider response data
- AND it MUST prevent an automatic replay from claiming or causing a known-safe duplicate delivery

#### Scenario: Permanent or invalid provider failure returns non-retryable failure

- GIVEN Gmail SMTP rejects authentication, the sender, the recipient, or the request for another permanent reason
- WHEN the backend completes processing
- THEN it MUST return a non-retryable failure category
- AND it MUST not report that the message was delivered

#### Scenario: Missing or invalid configuration fails safely

- GIVEN the Gmail SMTP email, Gmail app password, or required delivery configuration is absent or invalid
- WHEN a valid contact request reaches the submission boundary
- THEN the backend MUST refuse delivery
- AND it MUST return an unavailable or configuration-failure category
- AND it MUST not reveal which secret or configuration value is missing

### Requirement: Contract versioning and compatibility

The contact submission boundary and chat form metadata MUST be explicitly versioned. Additive compatible changes MAY be introduced under the same major contract, but changes to field meaning, validation, outcome semantics, or privacy guarantees MUST use a new version or an equivalent compatibility mechanism. Unsupported versions MUST fail safely without breaking text-only chat.

#### Scenario: Supported versions interoperate

- GIVEN the client and backend advertise compatible contact-form and submission contract versions
- WHEN the visitor submits a valid form
- THEN the request and response MUST follow the shared field, validation, privacy, and outcome semantics

#### Scenario: Unsupported submission version is rejected without delivery

- GIVEN the backend receives a submission version it does not support
- WHEN it validates the request
- THEN it MUST reject the request before calling Gmail SMTP
- AND it MUST return a stable unsupported-version category
- AND existing text-only chat endpoints MUST remain usable

#### Scenario: Backend rollout preserves older text-only clients

- GIVEN an older client does not understand the interview contact form capability
- WHEN it receives ordinary chat events or metadata
- THEN it MUST continue its existing text-only behavior
- AND the server MUST not require the client to submit contact data through the chat stream
