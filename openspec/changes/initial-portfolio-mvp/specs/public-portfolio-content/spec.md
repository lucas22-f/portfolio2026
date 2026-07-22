# Public Portfolio Content Specification

## Purpose

Define reviewed public evidence.

## Requirements

### Requirement: Spanish structured portfolio records

The system MUST expose reviewed Spanish profile, experience, education, skill, and project records as reusable structured data.

#### Scenario: Shared content presentation
- GIVEN an approved record exists
- WHEN a page or chat response references it
- THEN both surfaces present identical reviewed Spanish facts

#### Scenario: Missing optional field
- GIVEN an approved record omits an optional value
- WHEN the record is rendered
- THEN the surface remains valid and MUST NOT invent replacement text

### Requirement: Explicit CV provenance

Every factual record MUST cite approved `CV_Lucas_Figueroa7-7.pdf` evidence; unstated facts MUST NOT be published as evidence.

#### Scenario: Provenance audit
- GIVEN a published fact
- WHEN its provenance is inspected
- THEN it resolves to an explicit CV reference

#### Scenario: Unverified claim
- GIVEN a proposed claim is absent from the approved CV
- WHEN content is reviewed
- THEN the claim is rejected as factual evidence
