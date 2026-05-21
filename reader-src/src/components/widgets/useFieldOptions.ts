// Shared composable for resolving widget options:
// - prefers `x-options-url` (fetched once on mount via apiFetch with auth header)
// - falls back to `enum` on failure or when no URL
//
// Returns reactive { options, loading, fetchError }.

import { onMounted, ref } from "vue";
import type { Ref } from "vue";
import type { JsonSchema } from "@/lib/widget-registry";
import { apiFetch } from "@/lib/api";

export interface ResolvedOption {
  value: string;
  label: string;
}

export interface OptionResolverState {
  options: Ref<ResolvedOption[]>;
  loading: Ref<boolean>;
  fetchError: Ref<string | null>;
}

function enumOptions(schema: JsonSchema): ResolvedOption[] {
  const raw = schema["enum"];
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => ({ value: String(v), label: String(v) }));
}

export function useFieldOptions(schema: JsonSchema): OptionResolverState {
  const options = ref<ResolvedOption[]>(enumOptions(schema));
  const loading = ref(false);
  const fetchError = ref<string | null>(null);

  const url = schema["x-options-url"];
  if (typeof url === "string" && url.length > 0) {
    onMounted(async () => {
      loading.value = true;
      try {
        const res = await apiFetch(url, { throwOnError: false });
        if (!res.ok) {
          fetchError.value = `載入選項失敗（${res.status}）`;
          return;
        }
        const data: unknown = await res.json();
        if (
          data &&
          typeof data === "object" &&
          Array.isArray((data as { options?: unknown }).options)
        ) {
          const list = (data as { options: unknown[] }).options
            .map((item) => {
              if (item && typeof item === "object") {
                const o = item as Record<string, unknown>;
                if (typeof o.value === "string") {
                  return {
                    value: o.value,
                    label: typeof o.label === "string" ? o.label : o.value,
                  };
                }
              }
              return null;
            })
            .filter((x): x is ResolvedOption => x !== null);
          options.value = list;
        } else if (Array.isArray(data)) {
          // Tolerate older `string[]` shape from existing endpoints.
          options.value = (data as unknown[]).map((v) => ({
            value: String(v),
            label: String(v),
          }));
        } else {
          fetchError.value = "選項格式無效";
        }
      } catch (err) {
        fetchError.value = err instanceof Error ? err.message : "網路錯誤";
      } finally {
        loading.value = false;
      }
    });
  }

  return { options, loading, fetchError };
}
