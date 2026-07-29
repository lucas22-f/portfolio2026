# Delta for Grounded Portfolio Chat

## ADDED Requirements

### Requirement: Intentional embedded assistant focus

When embedded in the landing, the chat MUST preserve existing grounded response validation and provider behavior. It MUST NOT steal initial landing focus. It MAY move focus to the assistant only after an intentional assistant navigation or successful unlock, and the enabled chat MUST remain keyboard-accessible.

#### Scenario: Initial landing load
- GIVEN a visitor opens the landing with the assistant locked or unlocked
- WHEN the embedded chat initializes
- THEN focus remains at the landing's meaningful initial target

#### Scenario: Intentional assistant entry
- GIVEN the assistant is unlocked
- WHEN a visitor activates the return control or completes unlock
- THEN focus moves to the assistant's accessible entry point
