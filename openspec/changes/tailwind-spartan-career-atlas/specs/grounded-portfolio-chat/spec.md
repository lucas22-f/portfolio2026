# Delta for Grounded Portfolio Chat

## MODIFIED Requirements

### Requirement: Intentional embedded assistant focus

When embedded in the landing, the chat MUST preserve existing grounded response validation and provider behavior. It MUST NOT steal initial landing focus, and passive progress rendering or updates MUST NOT move focus to the chat. It MAY move focus to the assistant only after an intentional assistant navigation, successful Continue-driven unlock, or activation of the persistent return control; the enabled chat MUST remain keyboard-accessible. The chat MUST remain locked after reload until the visitor completes the journey again, and it MUST NOT persist unlock state through a backend, browser storage, or cross-session mechanism.

(Previously: intentional assistant entry covered unlock and return controls, but did not explicitly forbid passive-progress focus changes or persistence.)

#### Scenario: Initial landing load
- GIVEN a visitor opens the landing with the assistant locked or unlocked
- WHEN the embedded chat initializes
- THEN focus remains at the landing's meaningful initial target
- AND progress rendering does not move it to chat

#### Scenario: Intentional assistant entry
- GIVEN the assistant is unlocked
- WHEN a visitor activates the return control or completes unlock through Continue controls
- THEN focus moves to the assistant's accessible entry point
- AND the enabled chat remains keyboard-accessible

#### Scenario: Reload after unlock
- GIVEN a visitor previously unlocked the assistant
- WHEN they reload the landing
- THEN chat is locked until the journey is explicitly completed again
- AND no persisted unlock state is used
