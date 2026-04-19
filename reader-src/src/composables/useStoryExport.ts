import { useAuth } from "@/composables/useAuth";

export type ExportFormat = "md" | "json" | "txt";

const EXTENSIONS: Readonly<Record<ExportFormat, string>> = {
  md: "md",
  json: "json",
  txt: "txt",
};

/**
 * Download a story export for `series`/`name` in the requested format by
 * calling `GET /api/stories/:series/:name/export?format=<fmt>` with auth
 * headers, reading the response as a `Blob`, and triggering a browser
 * download via a temporary `<a download>` + object URL.
 *
 * Throws on non-2xx responses so callers can surface a UI error state.
 */
export async function exportStory(
  series: string,
  name: string,
  format: ExportFormat,
): Promise<void> {
  if (!series || !name) throw new Error("Missing series or story");

  const { getAuthHeaders } = useAuth();
  const url = `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(name)}/export?format=${format}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new Error(`Export failed with status ${res.status}`);
  }

  const blob = await res.blob();

  // Prefer server-provided filename from Content-Disposition header
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filenameMatch = disposition.match(/filename\*=UTF-8''([^\s;]+)/i)
    ?? disposition.match(/filename="([^"]+)"/i);
  const filename = filenameMatch
    ? decodeURIComponent(filenameMatch[1]!)
    : `${series}-${name}.${EXTENSIONS[format]}`;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export interface UseStoryExportReturn {
  exportStory: typeof exportStory;
}

export function useStoryExport(): UseStoryExportReturn {
  return { exportStory };
}
