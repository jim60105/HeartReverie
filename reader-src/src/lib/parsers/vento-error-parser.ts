import type { VentoErrorCardProps } from "@/types";

interface VentoErrorBlock {
  placeholder: string;
  data: VentoErrorCardProps;
}

/**
 * Extract `<vento-error>…</vento-error>` blocks from text, replacing each
 * with a unique placeholder comment. Returns the modified text and an array
 * of extracted blocks with their parsed data.
 */
export function extractVentoErrors(
  text: string,
): { text: string; blocks: VentoErrorBlock[] } {
  const blocks: VentoErrorBlock[] = [];
  const regex = /<vento-error\b[^>]*>([\s\S]*?)<\/vento-error>/gi;
  let index = 0;

  const replaced = text.replace(regex, (match, inner: string) => {
    const placeholder = `<!--VENTO_ERROR_${index}-->`;
    const data: VentoErrorCardProps = {
      message: extractField(inner, "message") ?? match,
      source: extractField(inner, "source") ?? undefined,
      line: extractField(inner, "line") ? Number(extractField(inner, "line")) : undefined,
      suggestion: extractField(inner, "suggestion") ?? undefined,
    };
    blocks.push({ placeholder, data });
    index++;
    return placeholder;
  });

  return { text: replaced, blocks };
}

function extractField(html: string, field: string): string | null {
  const regex = new RegExp(`<${field}[^>]*>([\\s\\S]*?)</${field}>`, "i");
  const match = html.match(regex);
  return match ? match[1]!.trim() : null;
}
