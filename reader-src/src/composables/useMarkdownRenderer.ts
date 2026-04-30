import { marked } from "marked";
import DOMPurify from "dompurify";
import { doubleNewlines, reinjectPlaceholders } from "@/lib/markdown-pipeline";
import { extractVentoErrors } from "@/lib/parsers/vento-error-parser";
import { frontendHooks } from "@/lib/plugin-hooks";
import { usePlugins } from "@/composables/usePlugins";
import { renderDebug } from "@/lib/render-debug";
import type {
  UseMarkdownRendererReturn,
  RenderOptions,
  RenderToken,
  VentoErrorCardProps,
  FrontendRenderContext,
  ChapterRenderAfterContext,
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

/**
 * Dispatch the `chapter:render:after` hook and re-sanitize any HTML-bearing
 * tokens that plugin handlers added or mutated. Re-sanitization is the
 * authoritative XSS safety net: plugins may only mutate tokens *after*
 * primary DOMPurify sanitization, so any replaced/added `.content` fields
 * MUST pass through DOMPurify again before renderChapter() returns them.
 * See spec: openspec/changes/frontend-hook-expansion — Requirement
 * "chapter:render:after hook context and mutation model".
 */
function dispatchChapterRenderAfter(
  tokens: RenderToken[],
  rawMarkdown: string,
  options: RenderOptions,
): void {
  // Snapshot each token's type and content so we can detect additions,
  // type mutations (e.g. non-html → html), and content mutations.
  const originalEntries = tokens.map((tok) => ({
    ref: tok,
    type: tok.type,
    content: tok.type === "html" ? tok.content : null as string | null,
  }));

  const ctx: ChapterRenderAfterContext = { tokens, rawMarkdown, options };
  frontendHooks.dispatch("chapter:render:after", ctx);

  // Re-sanitize any html token that was added, changed type to html, or
  // had its content mutated. This closes the non-html → html mutation XSS
  // vector: a plugin cannot convert e.g. a vento-error token into an html
  // token with unsanitized content.
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.type !== "html") continue;
    const original = originalEntries.find((e) => e.ref === tok);
    const isNew = !original;
    const wasMutatedToHtml = original !== undefined && original.type !== "html";
    const contentChanged =
      original !== undefined &&
      original.type === "html" &&
      original.content !== tok.content;
    if (isNew || wasMutatedToHtml || contentChanged) {
      tok.content = sanitizeHtml(tok.content);
    }
  }
}

function renderChapter(
  rawMarkdown: string,
  options: RenderOptions = {},
): RenderToken[] {
  renderDebug("chapter-render-dispatched", {
    frontendRenderHandlers: frontendHooks.getHandlerCount("frontend-render"),
    chapterRenderAfterHandlers: frontendHooks.getHandlerCount("chapter:render:after"),
  });
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

  // 3. Newline doubling
  text = doubleNewlines(text);

  // 4. Markdown → HTML via marked.parse()
  let html = marked.parse(text, { breaks: true }) as string;

  // 5. Reinject placeholders (for plugin-provided HTML content)
  html = reinjectPlaceholders(html, placeholderMap);

  // 6. Split HTML on structured placeholders to create RenderToken[]
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
    dispatchChapterRenderAfter(tokens, rawMarkdown, options);
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
      // 7. Sanitize HTML via DOMPurify (per-fragment, after split)
      const sanitized = sanitizeHtml(part);
      if (sanitized.trim()) {
        tokens.push({ type: "html", content: sanitized });
      }
    }
  }

  dispatchChapterRenderAfter(tokens, rawMarkdown, options);
  return tokens;
}

export function useMarkdownRenderer(): UseMarkdownRendererReturn {
  return { renderChapter };
}
