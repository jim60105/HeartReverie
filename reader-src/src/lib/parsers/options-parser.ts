import type { OptionItem } from "@/types";

/**
 * Extract all <options>…</options> blocks from text, replacing each with a
 * placeholder comment. Returns modified text and an array of parsed option data.
 */
export function extractOptionsBlocks(text: string): {
  text: string;
  blocks: Array<{ placeholder: string; data: OptionItem[] }>;
} {
  const blocks: Array<{ placeholder: string; data: OptionItem[] }> = [];
  let index = 0;

  const processed = text.replace(
    /<options>([\s\S]*?)<\/options>/gi,
    (_match: string, inner: string) => {
      const placeholder = `<!--OPTIONS_BLOCK_${index}-->`;
      const data = parseOptions(inner);
      blocks.push({ placeholder, data });
      index++;
      return placeholder;
    },
  );

  return { text: processed, blocks };
}

/**
 * Parse the raw content inside an <options> block.
 * Accepts lines like `1:【text】`, `1: text`, `option1: text`, etc.
 * Returns up to 4 items.
 */
export function parseOptions(blockContent: string): OptionItem[] {
  const items: OptionItem[] = [];
  const lineRegex = /(?:option)?(\d)(?:[:：.])\s*(?:【)?(.*?)(?:】)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(blockContent)) !== null && items.length < 4) {
    const text = m[2]!.trim();
    if (text) {
      items.push({ number: parseInt(m[1]!, 10), text });
    }
  }
  return items;
}
