// Plugin: imgthink — Strip imgthink tags from reader display
export function register(hooks) {
  hooks.register('frontend-strip', (context) => {
    context.text = context.text.replace(/<imgthink>[\s\S]*?<\/imgthink>/gi, '');
  }, 100);
}
