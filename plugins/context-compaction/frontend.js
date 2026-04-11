// Plugin: context-compaction — Strip <chapter_summary> tags from reader display

export function register(hooks) {
  hooks.register('frontend-strip', (context) => {
    context.text = context.text.replace(
      /<chapter_summary>[\s\S]*?<\/chapter_summary>/gi,
      ''
    );
  }, 100);
}
