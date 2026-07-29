# Delta for Guided Portfolio Experience

## MODIFIED Requirements

### Requirement: Guided journey with persistent escape

The experience MUST present one semantic landing in this fixed narrative order: intro/who I am, experience/work, projects, then assistant. It MUST NOT show a conventional header navbar, visually separate public pages, or an assistant bypass. The assistant MUST remain locked until the visitor explicitly completes the journey through scroll, keyboard, or touch-safe controls; completion MUST NOT depend on animation timing. Unlock state MUST remain in memory only and MUST reset on reload. After unlock, an accessible persistent control MUST return the visitor to the assistant section.

(Previously: guidance allowed classic navigation and direct chat access.)

#### Scenario: First-slice success path
- GIVEN a visitor opens the portfolio
- WHEN they explicitly complete the narrative journey
- THEN the embedded assistant becomes enabled
- AND the return-to-assistant control is available

#### Scenario: Guidance is bypassed
- GIVEN the assistant is locked
- WHEN a visitor tries a direct assistant route or fragment
- THEN the landing is shown without enabling the assistant

### Requirement: Accessible fallback

The experience MUST work by keyboard, touch, mobile viewport, and reduced-motion preference; information and unlocking MUST NOT depend on animation. Stable landing fragments MUST support initial deep links and browser Back/Forward history, while legacy public routes MUST redirect to their equivalent landing fragment without bypassing the lock. Initial landing load MUST retain meaningful reading-order focus.

(Previously: reduced-motion and keyboard/mobile use retained classic navigation.)

#### Scenario: Reduced-motion visitor
- GIVEN the visitor requests reduced motion
- WHEN the portfolio loads or navigates to a section
- THEN nonessential motion is suppressed
- AND navigation and unlocking remain usable

#### Scenario: Keyboard and mobile access
- GIVEN keyboard controls or a mobile viewport
- WHEN they traverse narrative content or use a fragment
- THEN focus, reading order, controls, and touch targets remain usable
- AND the assistant remains locked until completion
