## ADDED Requirements

### Requirement: Environment variable documentation file

The project SHALL provide a `.env.example` file at the repository root that documents every environment variable recognized by the application. Each variable entry SHALL include a comment describing its purpose and, where applicable, its default value. The file SHALL NOT contain real secrets or credentials — only placeholder values.

#### Scenario: New contributor setup
- **WHEN** a contributor clones the repository and copies `.env.example` to `.env`
- **THEN** the file SHALL contain entries for all recognized variables: `LLM_API_KEY`, `LLM_MODEL`, `LLM_API_URL`, `LLM_TEMPERATURE`, `LLM_FREQUENCY_PENALTY`, `LLM_PRESENCE_PENALTY`, `LLM_TOP_K`, `LLM_TOP_P`, `LLM_REPETITION_PENALTY`, `LLM_MIN_P`, `LLM_TOP_A`, `PORT`, `PASSPHRASE`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGIN_DIR`

#### Scenario: Placeholder values for secrets
- **WHEN** the `.env.example` file contains entries for secret variables (e.g., `LLM_API_KEY`, `PASSPHRASE`)
- **THEN** those entries SHALL use obvious placeholder values (e.g., `your-api-key-here`) and SHALL NOT contain real credentials

#### Scenario: Default values documented
- **WHEN** a variable has a default value in the application code
- **THEN** the `.env.example` entry SHALL show that default value commented out or as the assigned value, with a comment indicating it is the default
