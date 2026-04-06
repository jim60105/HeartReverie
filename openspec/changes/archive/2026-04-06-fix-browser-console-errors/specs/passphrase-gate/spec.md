## MODIFIED Requirements

### Requirement: Passphrase input form
The passphrase `<input>` and submit button SHALL be wrapped in a `<form>` element. The form SHALL use `event.preventDefault()` on submit to prevent page navigation. The existing submit logic SHALL be triggered by the form's `submit` event.

#### Scenario: Password field in form
- **WHEN** the passphrase overlay is rendered
- **THEN** the password input SHALL be contained within a `<form>` element, eliminating the browser DOM warning

#### Scenario: Form submission
- **WHEN** the user presses Enter in the password field or clicks the submit button
- **THEN** the form's submit event SHALL fire, `preventDefault()` SHALL be called, and the passphrase verification logic SHALL execute
