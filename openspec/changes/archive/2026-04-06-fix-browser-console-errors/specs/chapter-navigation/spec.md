## MODIFIED Requirements

### Requirement: Session restoration error handling
The `tryRestoreSession` function SHALL wrap `handleDirectorySelected` in a try/catch block. If a `NotFoundError` or any other error occurs (stale/deleted directory), the function SHALL silently clear the stored handle from IndexedDB and return without crashing.

#### Scenario: Stale directory handle
- **WHEN** a previously saved directory handle points to a directory that no longer exists
- **THEN** `tryRestoreSession` SHALL catch the `NotFoundError`, clear the stale handle from IndexedDB, and return gracefully without console errors

#### Scenario: Valid directory handle
- **WHEN** a previously saved directory handle is still valid
- **THEN** `tryRestoreSession` SHALL restore the session normally as before
