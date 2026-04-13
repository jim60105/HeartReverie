## MODIFIED Requirements

### Requirement: Scope Parameter Encoding
The API SHALL use explicit scope prefixes in route paths to unambiguously identify the target scope. Global scope routes SHALL use `/api/lore/global/...`, series scope routes SHALL use `/api/lore/series/:series/...`, and story scope routes SHALL use `/api/lore/story/:series/:story/...`. The backend SHALL resolve these route prefixes to co-located `_lore/` directories within the playground tree.

#### Scenario: Global scope routing
- **WHEN** client sends GET request to `/api/lore/global`
- **THEN** server maps to directory `playground/_lore/` and lists its passages

#### Scenario: Series scope routing
- **WHEN** client sends GET request to `/api/lore/series/my-series`
- **THEN** server maps to directory `playground/my-series/_lore/` and lists its passages

#### Scenario: Story scope routing
- **WHEN** client sends GET request to `/api/lore/story/my-series/my-story`
- **THEN** server maps to directory `playground/my-series/my-story/_lore/` and lists its passages
