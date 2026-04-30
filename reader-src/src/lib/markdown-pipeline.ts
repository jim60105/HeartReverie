/**
 * Double all newlines so markdown parsers treat single newlines as paragraph breaks.
 */
export function doubleNewlines(text: string): string {
  return text.replace(/\n/g, "\n\n");
}

/**
 * Replace placeholder comment tokens in rendered HTML with the corresponding
 * rendered component HTML. Placeholders may appear verbatim or inside paragraphs;
 * marked preserves HTML comments as-is, so a simple split-join works.
 */
export function reinjectPlaceholders(
  html: string,
  map: Map<string, string>,
): string {
  let result = html;
  for (const [placeholder, rendered] of map) {
    result = result.split(placeholder).join(rendered);
  }
  return result;
}
