# Chat Interview Contact Form Specification

## Purpose

Define the visitor-facing chat behavior for suggesting, confirming, rendering, and completing an inline interview/contact form without interrupting the conversation or exposing submitted personal data to the chat system.

## Requirements

### Requirement: Server-controlled interview form suggestion

The chat system MUST decide eligibility for an interview/contact form suggestion from the server-controlled conversation state and MUST present a suggestion rather than automatically opening the form or interrupting an active conversation.

#### Scenario: Eligible interview intent produces a suggestion

- GIVEN a visitor expresses employment, interview, or recruiting interest in a conversation
- WHEN the server determines that the current turn is eligible for contact
- THEN the assistant response MAY include one validated interview contact form suggestion
- AND the suggestion MUST expose a clear visitor action to open the form
- AND the form MUST NOT be rendered or focused before the visitor confirms the action

#### Scenario: Visitor declines an eligible suggestion

- GIVEN an eligible suggestion is visible
- WHEN the visitor dismisses or declines it
- THEN the form MUST remain closed
- AND the conversation MUST remain available without an automatic retry of the same suggestion in that turn

#### Scenario: Non-eligible conversation does not expose the form

- GIVEN the conversation contains no server-recognized interview or employment intent
- WHEN the assistant completes the turn
- THEN no interview contact form suggestion or form configuration MUST be emitted

#### Scenario: Ambiguous intent is handled safely

- GIVEN intent confidence or eligibility is insufficient for a form suggestion
- WHEN the assistant completes the turn
- THEN the system MUST prefer no form suggestion over an automatic form interruption

### Requirement: Explicit confirmation and inline form lifecycle

The visitor MUST explicitly confirm the suggestion before the form opens, and the form MUST have a deterministic lifecycle that supports opening, editing, cancellation, submission, completion, and recovery within the chat surface.

#### Scenario: Confirmation opens the form inline

- GIVEN a validated suggestion is visible in a completed chat turn
- WHEN the visitor activates its open action
- THEN the form MUST render inline in that turn
- AND the visitor MUST be able to edit the form without leaving the chat
- AND the active conversation transcript MUST remain intact

#### Scenario: Closing an untouched form

- GIVEN the form is open and no field contains visitor input
- WHEN the visitor closes or cancels the form
- THEN the form MUST return to its closed state
- AND no submission request MUST be made

#### Scenario: Closing a form with a draft

- GIVEN the form is open and contains an incomplete or invalid draft
- WHEN the visitor closes or cancels it
- THEN the system MUST not submit the draft
- AND the product MUST provide a predictable way to reopen or discard the draft without silently sending it

#### Scenario: Submission completes the form lifecycle

- GIVEN a form submission has succeeded
- WHEN the success response is received
- THEN the form MUST enter a completed state
- AND the submit action MUST no longer be available for the same completed submission
- AND the visitor MUST receive a clear next-step or completion message within the chat

### Requirement: Essential fields and consent communication

The form MUST collect exactly the essential contact fields: name, email, company, and message. It MUST communicate that activating submit authorizes delivery of the entered information to Lucas, but MUST NOT require a separate consent checkbox.

#### Scenario: Required fields are presented with purpose-specific labels

- GIVEN the visitor opens the form
- WHEN the form is rendered
- THEN it MUST present one control for name, one for email, one for company, and one for message
- AND each control MUST have a programmatically associated label
- AND no phone, URL, attachment, or unrelated field MUST be required by this capability

#### Scenario: Submit copy communicates consent

- GIVEN the visitor can submit the form
- WHEN the form displays its submit action
- THEN nearby supporting copy MUST state that submitting sends the entered contact information to the configured recipient for follow-up
- AND the copy MUST not imply that a separate mandatory consent checkbox is required

#### Scenario: Optional company value is handled consistently

- GIVEN the visitor does not have a company or chooses not to provide one
- WHEN the visitor attempts submission with all other valid required information
- THEN the form MUST follow the declared contract for an omitted company value consistently in both client and server validation
- AND the omission MUST NOT be converted into invented personal data

### Requirement: Client-side validation and safe form feedback

The client MUST validate field presence, format, and declared length limits before sending a submission request, while treating server validation as authoritative. Validation feedback MUST identify the affected field or form-level problem without echoing sensitive values into unrelated chat content.

#### Scenario: Valid draft passes client validation

- GIVEN name, email, company according to its requiredness contract, and message satisfy the published format and length rules
- WHEN the visitor activates submit
- THEN the client MUST allow exactly one submission attempt for the current draft
- AND it MUST send only the declared form fields and submission contract metadata

#### Scenario: Missing or malformed field is rejected locally

- GIVEN one or more required values are missing, malformed, or outside the declared length bounds
- WHEN the visitor activates submit
- THEN the client MUST prevent the network request
- AND it MUST identify the invalid field or fields
- AND it MUST move focus or otherwise expose feedback so the visitor can correct the draft

#### Scenario: Server rejects a client-accepted draft

- GIVEN the client considers a draft valid
- WHEN the server returns a validation error
- THEN the form MUST remain editable
- AND the visitor MUST receive actionable validation feedback
- AND the client MUST NOT mark the message as delivered

### Requirement: Submission states and recovery

The form MUST expose distinct idle/editing, loading, success, duplicate, validation-error, and retryable-failure states. Loading behavior MUST prevent accidental duplicate activation while retaining enough draft context for an allowed recovery.

#### Scenario: Loading prevents duplicate activation

- GIVEN a valid draft has been submitted
- WHEN the delivery request is pending
- THEN the form MUST show a perceivable loading state
- AND the submit action MUST be disabled or otherwise made idempotent
- AND repeated keyboard or pointer activation MUST NOT create parallel submissions for that draft

#### Scenario: Retryable delivery failure preserves recovery

- GIVEN the server reports a transient delivery failure or timeout
- WHEN the failure response is received
- THEN the form MUST leave loading state
- AND it MUST explain that delivery did not complete
- AND it MUST preserve the draft when safe to do so
- AND it MUST offer a retry action that does not create a second delivery for an already accepted submission

#### Scenario: Duplicate submission receives a safe outcome

- GIVEN the server determines that the submission has already been accepted or is already being processed
- WHEN the client receives the duplicate outcome
- THEN the form MUST NOT initiate another delivery
- AND it MUST communicate that the request was already received or is being handled
- AND the visitor MUST have a clear completion state rather than an ambiguous indefinite spinner

#### Scenario: Unavailable contact configuration is reported safely

- GIVEN the backend cannot use the configured contact-delivery service
- WHEN the visitor submits an otherwise valid form
- THEN the form MUST show a non-success, user-safe failure state
- AND it MUST not expose secrets, provider diagnostics, or internal configuration details
- AND it MUST not suggest that delivery occurred

### Requirement: Accessible keyboard, focus, responsive, and mobile interaction

The form MUST be usable with keyboard and assistive technology, MUST provide visible focus and state changes, and MUST remain operable on narrow mobile viewports without requiring horizontal scrolling.

#### Scenario: Keyboard-only visitor opens and submits the form

- GIVEN the visitor navigates the suggestion and form using only a keyboard
- WHEN the visitor confirms the suggestion, fills valid fields, and activates submit
- THEN every interactive control MUST be reachable in a logical order
- AND the focused element MUST be visible
- AND the submission MUST be possible without pointer input

#### Scenario: Focus is managed when the form opens

- GIVEN the visitor confirms the form suggestion
- WHEN the inline form becomes visible
- THEN focus MUST move to the form heading or first invalid/primary field according to the product's focus policy
- AND the new form context MUST be announced or otherwise exposed to assistive technology

#### Scenario: Errors and completion are announced

- GIVEN validation errors, loading, success, duplicate, or retryable failure state changes
- WHEN the state changes
- THEN the relevant status MUST be programmatically exposed
- AND focus MUST not be lost or trapped in an unreachable control

#### Scenario: Mobile layout remains usable

- GIVEN the viewport is narrow or the visitor uses a touch device
- WHEN the form is open in the chat transcript
- THEN controls and primary actions MUST remain readable and operable with touch-sized targets
- AND labels, errors, and actions MUST not overlap or require horizontal scrolling

### Requirement: Privacy-preserving chat protocol and compatibility behavior

The chat form part MUST contain only server-validated, non-PII configuration and intent metadata. Submitted field values MUST travel only through the dedicated submission boundary and MUST NOT be included in model prompts, chat SSE events, chat transcript content generated by the system, logs, or standard observability payloads. The versioned form contract MUST fail safely for unsupported clients.

#### Scenario: Form suggestion is schema-only

- GIVEN the server emits an interview contact form suggestion
- WHEN the client validates the streamed event
- THEN the event MUST contain only the supported form version, allowed field/configuration metadata, and non-PII eligibility context
- AND arbitrary HTML, executable content, provider-controlled field definitions, or prefilled personal values MUST be rejected

#### Scenario: Visitor values never enter chat transport

- GIVEN the visitor has entered one or more form values
- WHEN the visitor edits, submits, or receives a delivery response
- THEN those values MUST NOT be added to a model input, chat SSE event, assistant message, or chat lifecycle telemetry payload

#### Scenario: Unsupported form version is rejected safely

- GIVEN a client receives an unknown or unsafe interview form version
- WHEN it validates the event
- THEN it MUST ignore or reject the form part without rendering interactive content
- AND it MUST keep the remainder of the chat response safe and usable where possible

#### Scenario: Existing text-only chat remains compatible

- GIVEN a client or server does not support the interview contact form capability
- WHEN a text-only chat turn is exchanged
- THEN the existing text-only protocol behavior MUST continue without requiring contact-form configuration
- AND the server MUST NOT treat an unsupported form as a reason to fail the entire chat turn
