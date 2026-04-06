# Page Layout

## MODIFIED Requirements

### Requirement: Option button styling
Each option button SHALL be visually styled as a clickable button with clear borders, padding, and readable text. The option number SHALL be displayed alongside or within the button. The buttons SHALL have hover and active visual states defined entirely in CSS using `:hover` and `:active` pseudo-classes. No inline `onmouseover` or `onmouseout` event handlers SHALL be used.

#### Scenario: Buttons have interactive states via CSS
- **WHEN** the user hovers over an option button
- **THEN** the button SHALL visually indicate it is interactive (e.g., change background color or border) using CSS `:hover` rules, not inline JavaScript event handlers

#### Scenario: No inline hover handlers in HTML
- **WHEN** the page HTML is rendered
- **THEN** no elements SHALL contain `onmouseover` or `onmouseout` attributes

### Requirement: No global bridge functions
The page layout and application wiring SHALL NOT register global functions on the `window` object for inter-module communication (e.g., `window.__appendToInput`). Module communication SHALL use direct ES module imports instead. This eliminates global namespace pollution and enables strict CSP.

#### Scenario: window.__appendToInput is removed
- **WHEN** the application initializes
- **THEN** `window.__appendToInput` SHALL NOT be defined on the global `window` object

#### Scenario: Options panel communicates via module import
- **WHEN** the options panel needs to append text to the chat input
- **THEN** it SHALL import the `appendToInput` function directly from the `chat-input.js` module instead of calling a global bridge function

### Requirement: CSS hover states for interactive elements
All interactive elements (option buttons, navigation controls, folder picker) SHALL define their hover, focus, and active visual states using CSS pseudo-classes (`:hover`, `:focus`, `:active`). No inline event handlers (`onmouseover`, `onmouseout`, `onfocus`, `onblur`) SHALL be used for visual state changes anywhere in the page.

#### Scenario: All hover effects use CSS
- **WHEN** the page is rendered with interactive elements
- **THEN** all hover visual effects SHALL be defined in CSS stylesheets or `<style>` blocks using pseudo-classes, and no inline event handler attributes for visual state changes SHALL exist in the HTML

#### Scenario: CSP compatibility
- **WHEN** a strict Content Security Policy is active that blocks inline scripts
- **THEN** all interactive visual states SHALL continue to function because they are CSS-based, not JavaScript-based
