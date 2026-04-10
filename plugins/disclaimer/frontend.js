// Plugin: disclaimer — Strip disclaimer tags from reader display
export function register(hooks) {
  hooks.register('frontend-strip', (context) => {
    context.text = context.text.replace(/<disclaimer>[\s\S]*?<\/disclaimer>/gi, '');
  }, 100);
}
