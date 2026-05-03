## 1. Shared reserved-name rule

- [x] 1.1 Add or extend a backend helper/predicate to treat the platform reserved set (`lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`) as reserved alongside underscore-prefixed names.
- [x] 1.2 Wire the shared reserved-name predicate into all series/story parameter validation paths across the backend routes.

## 2. Directory listing and lore traversal updates

- [x] 2.1 Update `GET /api/stories` and `GET /api/stories/:series` directory filtering to exclude the reserved platform directory set in addition to current hidden/system rules.
- [x] 2.2 Update lore tag traversal (`GET /api/lore/tags`) series/story directory discovery to skip the reserved platform directory set as non-user system directories.

## 3. Regression coverage

- [x] 3.1 Add/update backend tests verifying story listing endpoints never return reserved platform directory names.
- [x] 3.2 Add/update backend tests verifying series/story parameter validation rejects all reserved platform literals.
- [x] 3.3 Add/update lore API tests verifying tag aggregation ignores traversal through reserved platform directories.
