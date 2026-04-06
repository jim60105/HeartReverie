## ADDED Requirements

### Requirement: Love-themed text selection
The application SHALL style text selection using `::selection` (and `::-moz-selection` for Firefox compatibility) with a rose/pink background colour from the love theme palette and appropriate text colour for contrast. The selection styling SHALL apply globally across all page content.

#### Scenario: Selection on prose text
- **WHEN** the user selects text within the story prose content area (`#content`)
- **THEN** the selected text SHALL display with a rose/pink background colour from the love theme palette and a contrasting text colour, instead of the browser default selection colours

#### Scenario: Selection on header and UI text
- **WHEN** the user selects text within the `<header>`, sidebar, or other UI elements
- **THEN** the selected text SHALL display with the same love-themed rose/pink background colour and contrasting text colour, maintaining visual consistency across the entire page
