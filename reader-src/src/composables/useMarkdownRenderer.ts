import { marked } from "marked";
import DOMPurify from "dompurify";
import { normalizeQuotes, doubleNewlines, reinjectPlaceholders } from "@/lib/markdown-pipeline";
import { extractStatusBlocks } from "@/lib/parsers/status-parser";
import { extractOptionsBlocks } from "@/lib/parsers/options-parser";
import { extractVariableBlocks } from "@/lib/parsers/variable-parser";
import { extractVentoErrors } from "@/lib/parsers/vento-error-parser";
import { frontendHooks } from "@/lib/plugin-hooks";
import { usePlugins } from "@/composables/usePlugins";
import type {
  UseMarkdownRendererReturn,
  RenderOptions,
  RenderToken,
  StatusBarProps,
  OptionItem,
  VariableDisplayProps,
  VentoErrorCardProps,
  FrontendRenderContext,
} from "@/types";

interface TokenData {
  type: "status" | "options" | "variable" | "vento-error";
  data: StatusBarProps | OptionItem[] | VariableDisplayProps | VentoErrorCardProps;
}

function renderChapter(
  rawMarkdown: string,
  options: RenderOptions = {},
): RenderToken[] {
  let text = rawMarkdown;
  const placeholderMap = new Map<string, string>();
  const tokenDataMap = new Map<string, TokenData>();

  // 1. Plugin-driven tag extraction and rendering
  const renderContext: FrontendRenderContext = { text, placeholderMap, options };
  frontendHooks.dispatch("frontend-render", renderContext);
  text = renderContext.text;

  // Extract structured blocks from custom XML tags
  const statusResult = extractStatusBlocks(text);
  text = statusResult.text;
  for (const block of statusResult.blocks) {
    placeholderMap.set(block.placeholder, block.placeholder);
    tokenDataMap.set(block.placeholder, { type: "status", data: block.data });
  }

  const optionsResult = extractOptionsBlocks(text);
  text = optionsResult.text;
  for (const block of optionsResult.blocks) {
    placeholderMap.set(block.placeholder, block.placeholder);
    tokenDataMap.set(block.placeholder, { type: "options", data: block.data });
  }

  const variableResult = extractVariableBlocks(text);
  text = variableResult.text;
  for (const block of variableResult.blocks) {
    placeholderMap.set(block.placeholder, block.placeholder);
    tokenDataMap.set(block.placeholder, { type: "variable", data: block.data });
  }

  // Vento errors come from options if present
  if (options.isLastChapter) {
    const ventoErrors = extractVentoErrors([]);
    for (const block of ventoErrors) {
      placeholderMap.set(block.placeholder, block.placeholder);
      tokenDataMap.set(block.placeholder, {
        type: "vento-error",
        data: block.data,
      });
    }
  }

  // 2. Apply declarative displayStripTags
  const { applyDisplayStrip } = usePlugins();
  text = applyDisplayStrip(text);

  // 3. Quote normalisation
  text = normalizeQuotes(text);

  // 4. Newline doubling
  text = doubleNewlines(text);

  // 5. Markdown → HTML via marked.parse()
  let html = marked.parse(text, { breaks: true }) as string;

  // 6. Reinject placeholders (for plugin-provided HTML content)
  html = reinjectPlaceholders(html, placeholderMap);

  // 7. Sanitize HTML via DOMPurify
  html = DOMPurify.sanitize(html, {
    ADD_TAGS: ["details", "summary"],
    ADD_ATTR: ["open"],
  });

  // 8. Split HTML on structured placeholders to create RenderToken[]
  const tokens: RenderToken[] = [];
  const allPlaceholders = Array.from(tokenDataMap.keys());

  if (allPlaceholders.length === 0) {
    // No structured tokens — return a single HTML token
    if (html.trim()) {
      tokens.push({ type: "html", content: html });
    }
    return tokens;
  }

  // Build a regex to split on all structured placeholders
  const escapedPlaceholders = allPlaceholders.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const splitRegex = new RegExp(`(${escapedPlaceholders.join("|")})`);
  const parts = html.split(splitRegex);

  for (const part of parts) {
    const tokenData = tokenDataMap.get(part);
    if (tokenData) {
      switch (tokenData.type) {
        case "status":
          tokens.push({
            type: "status",
            data: tokenData.data as StatusBarProps,
          });
          break;
        case "options":
          tokens.push({
            type: "options",
            data: tokenData.data as OptionItem[],
          });
          break;
        case "variable":
          tokens.push({
            type: "variable",
            data: tokenData.data as VariableDisplayProps,
          });
          break;
        case "vento-error":
          tokens.push({
            type: "vento-error",
            data: tokenData.data as VentoErrorCardProps,
          });
          break;
      }
    } else if (part.trim()) {
      tokens.push({ type: "html", content: part });
    }
  }

  return tokens;
}

export function useMarkdownRenderer(): UseMarkdownRendererReturn {
  return { renderChapter };
}
