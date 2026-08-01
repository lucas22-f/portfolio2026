# Delta for Guided Portfolio Experience

## MODIFIED Requirements

### Requirement: Guided journey with persistent escape

The experience MUST present one semantic landing: intro, experience, projects, then assistant. It MUST NOT show a conventional navbar, separate public pages, or an assistant bypass. The landing MUST use Tailwind CSS v4 utilities for layout, responsiveness, typography, spacing, surfaces, and interactive states; CSS MAY remain only for documented tokens, pseudo/focus behavior, or complex reduced-motion rules. The journey MUST render genuine maintained Spartan Brain Progress with copied Helm Progress styles; a native, custom, or equivalent substitute MUST NOT satisfy this requirement. Missing Spartan setup MUST be completed as setup work, never as permission for a substitute. Progress MUST represent the discrete journey state and remain passive: it MUST NOT navigate, focus, unlock, relock, or change content. The assistant MUST remain locked until the visitor explicitly completes the journey through Continue controls; completion MUST NOT depend on scrolling or animation timing. Unlock state MUST remain in memory only and reset on reload. After unlock, an accessible persistent control MUST return the visitor to the assistant.

(Previously: explicit completion and an in-memory unlock lacked Tailwind composition and genuine Spartan Brain/Helm progress.)

#### Scenario: Runtime composition and progress
- GIVEN a visitor opens the landing
- WHEN the journey renders at any discrete state
- THEN Tailwind utilities compose the landing and Brain-backed Helm Progress exposes an accessible state value
- AND the visible value matches the current journey state

#### Scenario: Passive progress cannot bypass guidance
- GIVEN the assistant is locked
- WHEN a visitor scrolls, interacts with, or changes focus within the progress display
- THEN the narrative state and lock state remain unchanged
- AND only Continue can advance the journey

#### Scenario: First-slice success path
- GIVEN a visitor opens the portfolio
- WHEN they activate each required Continue control in narrative order
- THEN focus moves to the next semantic section after each transition
- AND the embedded assistant becomes enabled only at completion

#### Scenario: Reload relocks the assistant
- GIVEN a visitor has unlocked the assistant
- WHEN they reload the landing
- THEN the assistant is locked again
- AND no prior unlock is restored from browser or backend persistence

#### Scenario: Guidance is bypassed
- GIVEN the assistant is locked
- WHEN a visitor tries a direct assistant route or fragment
- THEN the landing is shown without enabling the assistant

### Requirement: Accessible fallback

The experience MUST work by keyboard, touch, mobile viewport, and reduced-motion preference; information, progress updates, and unlocking MUST NOT depend on animation. Stable fragments MUST support deep links and browser history, while legacy routes MUST redirect to their equivalent fragment without bypassing the lock. Initial load MUST retain meaningful focus. Progress MUST expose an accessible name and current value without becoming navigation. The responsive landing MUST remain usable at a 390px viewport, and the production build MUST remain within the configured 500 kB warning / 1 MB error and 4/8 kB style budgets.

(Previously: accessibility covered reduced motion and navigation, without explicit passive-progress semantics or bundle/style limits.)

#### Scenario: Reduced-motion visitor
- GIVEN the visitor requests reduced motion
- WHEN the portfolio loads, progresses, or navigates to a section
- THEN nonessential motion is suppressed
- AND progress, navigation, and unlocking remain usable

#### Scenario: Keyboard and mobile access
- GIVEN keyboard controls or a 390px mobile viewport
- WHEN the visitor traverses narrative content or uses a fragment
- THEN focus, reading order, controls, and touch targets remain usable
- AND the assistant remains locked until completion

#### Scenario: Budget compliance
- GIVEN the production landing is built with Brain Progress and Helm styles
- WHEN build budgets are evaluated
- THEN no 1 MB bundle or 8 kB style error budget is exceeded
- AND any 500 kB bundle or 4 kB style warning is reported as verification evidence
