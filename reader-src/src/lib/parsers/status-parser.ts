import type { StatusBarProps, CloseUpEntry } from "@/types";
import { escapeHtml } from "../string-utils";

/**
 * Extract all <status>…</status> blocks from text, replacing each with a
 * placeholder comment. Returns modified text and an array of parsed data blocks.
 */
export function extractStatusBlocks(text: string): {
  text: string;
  blocks: Array<{ placeholder: string; data: StatusBarProps }>;
} {
  const blocks: Array<{ placeholder: string; data: StatusBarProps }> = [];
  let index = 0;

  const processed = text.replace(
    /<status>([\s\S]*?)<\/status>/gi,
    (_match: string, inner: string) => {
      const placeholder = `<!--STATUS_BLOCK_${index}-->`;
      try {
        const data = parseStatus(inner);
        blocks.push({ placeholder, data });
      } catch {
        // Fallback: show raw block text as the name field
        blocks.push({
          placeholder,
          data: {
            name: escapeHtml(inner.trim()),
            title: "",
            scene: "",
            thought: "",
            items: "",
            clothes: "",
            shoes: "",
            socks: "",
            accessories: "",
            closeUps: [],
          },
        });
      }
      index++;
      return placeholder;
    },
  );

  return { text: processed, blocks };
}

/**
 * Parse the raw content inside a <status> block into a structured object.
 * Handles partial / missing sections gracefully.
 */
export function parseStatus(blockContent: string): StatusBarProps {
  const data: StatusBarProps = {
    name: "",
    title: "",
    scene: "",
    thought: "",
    items: "",
    clothes: "",
    shoes: "",
    socks: "",
    accessories: "",
    closeUps: [],
  };

  // ── 基礎 section ──
  const baseMatch = blockContent.match(/基礎[:：]\s*\[([\s\S]*?)\]/);
  if (baseMatch) {
    const fields = splitPipe(baseMatch[1]!);
    data.name = fields[0] ?? "";
    data.title = fields[1] ?? "";
    data.scene = fields[2] ?? "";
    data.thought = fields[3] ?? "";
    data.items = fields[4] ?? "";
  }

  // ── 服飾 section ──
  const outfitMatch = blockContent.match(/服飾[:：]\s*\[([\s\S]*?)\]/);
  if (outfitMatch) {
    const fields = splitPipe(outfitMatch[1]!);
    data.clothes = fields[0] ?? "";
    data.shoes = fields[1] ?? "";
    data.socks = fields[2] ?? "";
    data.accessories = fields[3] ?? "";
  }

  // ── 特寫 section — one or more [Part|Description] entries ──
  const closeUpSection = blockContent.match(/特寫[:：]\s*([\s\S]*)$/);
  if (closeUpSection) {
    const cuRegex = /\[([\s\S]*?)\|([\s\S]*?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = cuRegex.exec(closeUpSection[1]!)) !== null) {
      const entry: CloseUpEntry = {
        part: m[1]!.trim(),
        description: m[2]!.trim(),
      };
      data.closeUps.push(entry);
    }
  }

  return data;
}

function splitPipe(str: string): string[] {
  return str.split("|").map((s) => s.trim());
}
