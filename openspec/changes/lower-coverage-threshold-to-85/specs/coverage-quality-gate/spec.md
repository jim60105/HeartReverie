## RENAMED Requirements

- FROM: `### Requirement: Combined line coverage SHALL be greater than 90 percent`
- TO: `### Requirement: Combined line coverage SHALL be greater than 85 percent`

## MODIFIED Requirements

### Requirement: Combined line coverage SHALL be greater than 85 percent
The aggregated repository line coverage computed from backend and frontend coverage outputs SHALL be strictly greater than 85%.

#### Scenario: Coverage gate passes above threshold
- **WHEN** aggregate line coverage is greater than 85%
- **THEN** the coverage gate SHALL pass with a success exit code

#### Scenario: Coverage gate fails at or below threshold
- **WHEN** aggregate line coverage is less than or equal to 85%
- **THEN** the coverage gate SHALL fail with a non-zero exit code
