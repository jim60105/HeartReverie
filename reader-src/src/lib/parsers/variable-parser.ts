import type { VariableDisplayProps } from "@/types";

/**
 * Extract all <UpdateVariable>…</UpdateVariable> (complete) and unclosed
 * <UpdateVariable> (incomplete) blocks from text, replacing each with a
 * placeholder comment. Complete blocks are extracted first so their opening
 * tags are not consumed by the incomplete pattern.
 *
 * Tag matching is case-insensitive and also accepts the short form <update>.
 */
export function extractVariableBlocks(text: string): {
  text: string;
  blocks: Array<{ placeholder: string; data: VariableDisplayProps }>;
} {
  const blocks: Array<{ placeholder: string; data: VariableDisplayProps }> = [];
  let index = 0;

  // 1. Extract COMPLETE blocks first: <update(variable)?>…</update(variable)?>
  text = text.replace(
    /<(update(?:variable)?)>\s*((?:(?!<\1>)[\s\S])*?)\s*<\/\1>/gi,
    (_match: string, _tag: string, inner: string) => {
      const placeholder = `<!--VARIABLE_BLOCK_${index}-->`;
      blocks.push({
        placeholder,
        data: { content: inner.trim(), isComplete: true },
      });
      index++;
      return placeholder;
    },
  );

  // 2. Extract INCOMPLETE blocks: <update(variable)?> with no closing tag
  text = text.replace(
    /<(update(?:variable)?)>(?![\s\S]*<\/\1>)\s*((?:(?!<\1>)[\s\S])*)\s*$/gi,
    (_match: string, _tag: string, inner: string) => {
      const placeholder = `<!--VARIABLE_BLOCK_${index}-->`;
      blocks.push({
        placeholder,
        data: { content: inner.trim(), isComplete: false },
      });
      index++;
      return placeholder;
    },
  );

  return { text, blocks };
}
