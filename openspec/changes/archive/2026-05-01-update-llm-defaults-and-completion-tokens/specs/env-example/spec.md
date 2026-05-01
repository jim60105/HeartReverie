## MODIFIED Requirements

### Requirement: Environment variable documentation file

The project SHALL provide a `.env.example` file at the repository root that documents every environment variable recognized by the application. Each variable entry SHALL include a comment describing its purpose and, where applicable, its default value. The file SHALL NOT contain real secrets or credentials — only placeholder values.

#### Scenario: New contributor setup
- **WHEN** a contributor clones the repository and copies `.env.example` to `.env`
- **THEN** the file SHALL contain entries for all recognized variables: `LLM_API_KEY`, `LLM_MODEL`, `LLM_API_URL`, `LLM_TEMPERATURE`, `LLM_FREQUENCY_PENALTY`, `LLM_PRESENCE_PENALTY`, `LLM_TOP_K`, `LLM_TOP_P`, `LLM_REPETITION_PENALTY`, `LLM_MIN_P`, `LLM_TOP_A`, `LLM_MAX_COMPLETION_TOKENS`, `LLM_REASONING_ENABLED`, `LLM_REASONING_EFFORT`, `LLM_REASONING_OMIT`, `PORT`, `PASSPHRASE`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGIN_DIR`, `PROMPT_FILE`, `BACKGROUND_IMAGE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE`

#### Scenario: Placeholder values for secrets
- **WHEN** the `.env.example` file contains entries for secret variables (e.g., `LLM_API_KEY`, `PASSPHRASE`)
- **THEN** those entries SHALL use obvious placeholder values (e.g., `your-api-key-here`) and SHALL NOT contain real credentials

#### Scenario: Default values documented
- **WHEN** a variable has a default value in the application code
- **THEN** the `.env.example` entry SHALL show that default value commented out or as the assigned value, with a comment indicating it is the default

#### Scenario: PROMPT_FILE documented
- **WHEN** a contributor inspects the `.env.example` file
- **THEN** the `PROMPT_FILE` entry SHALL describe it as the path to the custom prompt template file, with the default value `playground/_prompts/system.md` shown as a comment

#### Scenario: LLM_MODEL default reflects deepseek-v4-pro
- **WHEN** a contributor inspects the `.env.example` file
- **THEN** the `LLM_MODEL` entry SHALL document the default value as `deepseek/deepseek-v4-pro`

#### Scenario: LLM_MAX_COMPLETION_TOKENS documented
- **WHEN** a contributor inspects the `.env.example` file
- **THEN** the `LLM_MAX_COMPLETION_TOKENS` entry SHALL describe it as the upper bound (positive integer) on tokens generated per chat turn (mapped to the upstream `max_completion_tokens` request body field), with the default value `4096` shown as a comment

#### Scenario: LLM_REASONING_EFFORT default reflects xhigh
- **WHEN** a contributor inspects the `.env.example` file
- **THEN** the `LLM_REASONING_EFFORT` entry SHALL document the default value as `xhigh` and SHALL list the accepted values `none`, `minimal`, `low`, `medium`, `high`, `xhigh`
