## ADDED Requirements

### Requirement: Non-blocking file access
The file reading mechanism SHALL use snapshot-based access (via `FileSystemFileHandle.getFile()`) that does not hold persistent file locks. Other applications SHALL be able to freely read, write, and edit the same files while the reader has the directory open.

#### Scenario: External application can edit files while reader is open
- **WHEN** the reader has a directory open and is displaying a chapter
- **THEN** external applications SHALL be able to write to or modify any `.md` file in the directory without being blocked by the reader

#### Scenario: File content is read as a snapshot
- **WHEN** the reader loads a chapter file
- **THEN** the file content SHALL be read as a point-in-time snapshot (blob), and no file handle or lock SHALL be held after reading completes
