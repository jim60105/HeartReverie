## MODIFIED Requirements

### Requirement: Environment variable documentation file

#### Scenario: PROMPT_FILE documented
- **WHEN** a contributor inspects the `.env.example` file
- **THEN** the `PROMPT_FILE` entry SHALL describe it as the path to the custom prompt template file, with the default value `playground/_prompts/system.md` shown as a comment
