# Grounded Portfolio Chat Specification

## Purpose

Define Spanish evidence-grounded chat.

## Requirements

### Requirement: Grounded Spanish responses

The chat MUST answer only in Spanish from deterministically selected approved evidence and refuse unsupported requests without inference.

#### Scenario: Supported project question
- GIVEN a question matches approved project evidence
- WHEN the visitor submits it
- THEN the Spanish response contains only supported claims and MAY include its project card

#### Scenario: Unsupported or unsafe question
- GIVEN no approved evidence supports a question or the request is unsafe
- WHEN the visitor submits it
- THEN the chat returns a safe Spanish refusal without fabrication

### Requirement: Allow-listed response parts

Responses MUST contain only validated `text`, `source`, or `project-card` parts with typed fields; arbitrary HTML MUST NOT be accepted or rendered.

#### Scenario: Typed grounded response
- GIVEN the provider returns valid typed parts
- WHEN the client renders the answer
- THEN each part renders according to its declared type

#### Scenario: Invalid provider output
- GIVEN the provider returns unknown parts, malformed fields, or HTML
- WHEN the response is validated
- THEN invalid content is rejected and a safe Spanish error is shown

### Requirement: Provider and cost controls

The service MUST keep OpenAI credentials server-side, enforce configurable model and usage limits, and expose Spanish timeout, quota, rate-limit, and failure states.

#### Scenario: Limit or provider failure
- GIVEN a limit is exceeded or OpenAI is unavailable
- WHEN a chat request is processed
- THEN generation stops and a recoverable error is shown

#### Scenario: Mocked continuous integration
- GIVEN tests run without live provider credentials
- WHEN chat behavior is verified
- THEN a mocked provider covers grounded success, refusal, typed output, and failure states without external cost
