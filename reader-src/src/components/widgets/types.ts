// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Shared widget type contracts. Widgets accept this Props shape and emit `update:modelValue`.

import type { ValidationError } from "@/lib/validation-i18n";
import type { FormContextValue, JsonSchema } from "@/lib/widget-registry";

export interface WidgetProps {
  schema: JsonSchema;
  path: string;
  modelValue: unknown;
  errors: ValidationError[];
  context: FormContextValue;
}
