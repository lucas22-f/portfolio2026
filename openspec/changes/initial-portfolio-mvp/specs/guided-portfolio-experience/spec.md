# Guided Portfolio Experience Specification

## Purpose

Define accessible navigation to grounded chat.

## Requirements

### Requirement: Guided journey with persistent escape

The experience MUST guide progressive scrolling in Spanish and keep classic navigation always available.

#### Scenario: First-slice success path
- GIVEN a visitor opens the portfolio
- WHEN they follow the guided journey through its final step
- THEN they reach full chat while retaining direct section navigation

#### Scenario: Guidance is bypassed
- GIVEN a visitor bypasses guidance
- WHEN they select a classic navigation destination
- THEN that section opens without guided steps

### Requirement: Accessible fallback

The experience MUST work by keyboard, on mobile, and with reduced motion; information MUST NOT depend on animation.

#### Scenario: Reduced-motion visitor
- GIVEN the visitor requests reduced motion
- WHEN the portfolio loads
- THEN content appears without nonessential motion and navigation remains usable

#### Scenario: Keyboard and mobile access
- GIVEN keyboard controls or a mobile viewport
- WHEN they traverse navigation and guided content
- THEN focus, reading order, controls, and touch targets remain usable
