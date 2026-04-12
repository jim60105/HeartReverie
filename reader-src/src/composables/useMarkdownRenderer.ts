import { marked } from "marked";
import DOMPurify from "dompurify";
import { normalizeQuotes, doubleNewlines, reinjectPlaceholders } from "@/lib/markdown-pipeline";
import { extractVentoErrors } from "@/lib/parsers/vento-error-parser";
import { frontendHooks } from "@/lib/plugin-hooks";
import { usePlugins } from "@/composables/usePlugins";
import type {
  UseMarkdownRendererReturn,
  RenderOptions,
  RenderToken,
  VentoErrorCardProps,
  FrontendRenderContext,
} from "@/types";

interface TokenData {
  type: "vento-error";
  data: VentoErrorCardProps;
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["details", "summary"],
    ADD_ATTR: ["open"],
  });
}

function renderChapter(
  rawMarkdown: string,
  options: RenderOptions = {},
): RenderToken[] {
  let text = rawMarkdown;
  const placeholderMap = new Map<string, string>();
  const tokenDataMap = new Map<string, TokenData>();

  // 1. Extract structured blocks from custom XML tags.
  //    <status>, <options>, and <UpdateVariable> blocks are handled by their
  //    respective plugins' frontend-render hooks, not by native extraction.

  // Vento errors are a native feature (no plugin), only in the last chapter
  if (options.isLastChapter) {
    const ventoErrorResult = extractVentoErrors(text);
    text = ventoErrorResult.text;
    for (const block of ventoErrorResult.blocks) {
      placeholderMap.set(block.placeholder, block.placeholder);
      tokenDataMap.set(block.placeholder, {
        type: "vento-error",
        data: block.data,
      });
    }
  }

  // 2. Plugin-driven tag extraction and rendering (third-party plugins)
  const renderContext: FrontendRenderContext = { text, placeholderMap, options };
  frontendHooks.dispatch("frontend-render", renderContext);
  text = renderContext.text;

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

  // 7. Split HTML on structured placeholders to create RenderToken[]
  //    This must happen BEFORE DOMPurify because DOMPurify strips
  //    HTML comment placeholders (<!--STATUS_BLOCK_0--> etc.).
  const tokens: RenderToken[] = [];
  const allPlaceholders = Array.from(tokenDataMap.keys());

  if (allPlaceholders.length === 0) {
    // No structured tokens — return a single HTML token
    const sanitized = sanitizeHtml(html);
    if (sanitized.trim()) {
      tokens.push({ type: "html", content: sanitized });
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
        case "vento-error":
          tokens.push({
            type: "vento-error",
            data: tokenData.data as VentoErrorCardProps,
          });
          break;
      }
    } else if (part.trim()) {
      // 8. Sanitize HTML via DOMPurify (per-fragment, after split)
      const sanitized = sanitizeHtml(part);
      if (sanitized.trim()) {
        tokens.push({ type: "html", content: sanitized });
      }
    }
  }

  return tokens;
}

export function useMarkdownRenderer(): UseMarkdownRendererReturn {
  return { renderChapter };
}
