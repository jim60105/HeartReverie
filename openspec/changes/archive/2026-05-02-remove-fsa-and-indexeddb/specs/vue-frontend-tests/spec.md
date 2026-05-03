## MODIFIED Requirements

### Requirement: Mock patterns for browser APIs

Tests requiring browser APIs SHALL use Vitest mocking utilities (`vi.fn()`, `vi.mock()`, `vi.stubGlobal()`) to provide test doubles. The following browser APIs SHALL have mock implementations: `fetch` (via `vi.fn()` returning mock Response objects), `navigator.clipboard` (via `vi.stubGlobal`), `localStorage` (via `vi.stubGlobal` or jsdom built-in), and `window.location` (hash manipulation for chapter state).

#### Scenario: Fetch mock for API calls
- **WHEN** a composable test calls a function that invokes `fetch('/api/auth', ...)`
- **THEN** `fetch` SHALL be mocked with `vi.fn()` returning a controlled `Response` object, and the test SHALL verify the request URL, method, and headers

#### Scenario: localStorage mock for prompt editor
- **WHEN** `usePromptEditor()` tests verify template persistence
- **THEN** `localStorage.getItem` and `localStorage.setItem` SHALL be mocked or use the jsdom built-in, and the test SHALL verify correct keys and values

#### Scenario: Clipboard mock for copy operations
- **WHEN** tests verify clipboard copy functionality
- **THEN** `navigator.clipboard.writeText` SHALL be mocked with `vi.fn()` and the test SHALL verify the copied text content
