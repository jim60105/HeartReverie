// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Predicate identifying routes that count as "reading" routes (eligible for
// last-reading-route capture and the `← 返回閱讀` back-button target).
//
// A route is a reading route iff its path is NONE of:
//   - exactly `/settings`
//   - starting with `/settings/`
//   - exactly `/tools`
//   - starting with `/tools/`
//
// A loose `startsWith("/settings")` or `startsWith("/tools")` MUST NOT be
// used: a series slug whose first segment merely begins with `settings` or
// `tools` (e.g. `/settings-archive/my-story`, `/tools-archive/my-story`)
// would otherwise be misclassified.

export function isReadingRoute(path: string): boolean {
  if (path === "/settings" || path.startsWith("/settings/")) return false;
  if (path === "/tools" || path.startsWith("/tools/")) return false;
  return true;
}
