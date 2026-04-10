// Plugin: t-task — Strip T-task tags from reader display
export function register(hooks) {
  hooks.register('frontend-strip', (context) => {
    context.text = context.text.replace(/<T-task\b[^>]*>[\s\S]*?<\/T-task>/g, '');
  }, 100);
}
