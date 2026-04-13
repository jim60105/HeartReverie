## ADDED Requirements

### Requirement: Automatic directory polling
The application SHALL poll the selected directory every 1 second to detect new chapter files. When new `.md` files matching the chapter naming pattern are found, the internal file list SHALL be updated and the navigation UI SHALL reflect the new chapter count without disrupting the current chapter being displayed.

#### Scenario: New chapter file appears during reading
- **WHEN** the user is reading chapter 3 of 5 and a new file `006.md` is written to the directory by an external application
- **THEN** within 1 second, the chapter progress indicator SHALL update to show "3 / 6" and the "Next" button SHALL remain enabled, without changing the displayed chapter content or scroll position

#### Scenario: Polling starts after directory selection
- **WHEN** a directory is successfully selected (either via picker or session restore)
- **THEN** the polling interval SHALL begin automatically at 1-second intervals

#### Scenario: Previous polling stops on new directory selection
- **WHEN** the user selects a new directory while polling is active for a previous directory
- **THEN** the previous polling interval SHALL be stopped before starting a new one

### Requirement: Manual reload button
The application SHALL provide a reload button (🔄) in the `<header>` element that allows the user to manually re-scan the directory for new chapter files. The button SHALL be hidden until a story folder is loaded.

#### Scenario: Reload button triggers directory re-scan
- **WHEN** the user clicks the reload button
- **THEN** the application SHALL immediately re-scan the directory for chapter files and update the file list and navigation UI

#### Scenario: Reload button hidden before story is loaded
- **WHEN** no story folder has been selected
- **THEN** the reload button SHALL not be visible in the header
