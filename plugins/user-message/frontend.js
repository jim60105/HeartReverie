// Plugin: user-message — Strip user_message tags from reader display
export function register(hooks) {
  hooks.register('frontend-strip', (context) => {
    context.text = context.text.replace(/<user_message>[\s\S]*?<\/user_message>/gi, '');
  }, 100);
}
