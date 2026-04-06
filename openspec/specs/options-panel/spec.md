# Options Panel

## Purpose

Detects, parses, and renders `<options>` blocks from chapter content into a 2×2 interactive button grid, supporting numbered option extraction, styled display, clipboard copy on click, and graceful handling of malformed input.

## Requirements

### Requirement: Options block detection and extraction
The renderer SHALL detect `<options>...</options>` blocks in the chapter content. The entire block from opening to closing tag SHALL be extracted for structured parsing.

#### Scenario: Options block is present in chapter
- **WHEN** the chapter content contains an `<options>...</options>` block
- **THEN** the block SHALL be extracted and passed to the options panel renderer

#### Scenario: No options block in chapter
- **WHEN** the chapter content does not contain an `<options>` block
- **THEN** no options panel SHALL be rendered for that chapter

### Requirement: Parsing numbered option items
The options parser SHALL extract exactly 4 numbered items from the block. Each item follows the format `N:【text】` or `N: 【text】` where N is 1 through 4. The parser SHALL strip the `【` and `】` bracket characters from the option text.

#### Scenario: Standard four options are parsed
- **WHEN** the options block contains lines `1:【Option A】`, `2:【Option B】`, `3:【Option C】`, `4:【Option D】`
- **THEN** the parser SHALL extract four items with text `Option A`, `Option B`, `Option C`, `Option D` respectively, with brackets removed

#### Scenario: Options with varied whitespace
- **WHEN** the options block contains `1: 【Option A】` (with extra space after colon)
- **THEN** the parser SHALL still correctly extract the option text `Option A`

### Requirement: 2×2 button grid layout
The four parsed options SHALL be rendered as a 2×2 grid of styled buttons. Options 1 and 2 SHALL appear in the first row, and options 3 and 4 in the second row.

#### Scenario: Four options render as 2×2 grid
- **WHEN** four options are parsed from the block
- **THEN** the renderer SHALL display them in a 2-column, 2-row grid layout where option 1 is top-left, option 2 is top-right, option 3 is bottom-left, and option 4 is bottom-right

### Requirement: Option button styling
Each option button SHALL be visually styled as a clickable button with clear borders, padding, and readable text. The option number SHALL be displayed alongside or within the button. The buttons SHALL have hover and active visual states.

#### Scenario: Buttons show option numbers
- **WHEN** the options panel is rendered
- **THEN** each button SHALL display its option number (1–4) along with the option text

#### Scenario: Buttons have interactive states
- **WHEN** the user hovers over an option button
- **THEN** the button SHALL visually indicate it is interactive (e.g., change background color or border)

### Requirement: Option button click behavior
Since this is a standalone reader (no SillyTavern integration), clicking an option button SHALL copy the option text to the clipboard. A brief visual feedback (e.g., a toast notification or button state change) SHALL confirm the copy action.

#### Scenario: Clicking an option copies text to clipboard
- **WHEN** the user clicks on option button 2 with text `走向藥妝店，想看看有沒有新出的商品`
- **THEN** the text `走向藥妝店，想看看有沒有新出的商品` SHALL be copied to the system clipboard and a visual confirmation SHALL be shown

### Requirement: Handling malformed options blocks
The renderer SHALL gracefully handle options blocks that contain fewer than 4 items or items that do not follow the expected format. Available items SHALL still be rendered.

#### Scenario: Options block with only 3 items
- **WHEN** the options block contains only items numbered 1 through 3
- **THEN** the renderer SHALL display the 3 available options and leave the fourth grid cell empty or hidden without causing errors
