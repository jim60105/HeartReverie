// Ambient type declarations for ventojs@^2.3.1
// Pin: update when upgrading ventojs version
declare module "ventojs" {
  /**
   * A compiled Vento template — callable with a data record to produce a
   * `TemplateResult`. Includes the parsed source / generated code as
   * metadata fields for AST-walking lint rules.
   */
  export interface VentoTemplate {
    (data?: Record<string, unknown>): Promise<{ content: string; [key: string]: unknown }>;
    readonly source: string;
    readonly code: string;
    readonly path?: string;
    readonly defaults?: Record<string, unknown>;
  }

  export interface VentoEnvironment {
    run(template: string, data: Record<string, unknown>): Promise<{ content: string }>;
    runString(template: string, data: Record<string, unknown>): Promise<{ content: string }>;
    load(path: string): Promise<{ source: string }>;
    /**
     * Parse a Vento source string and return a callable template. Synchronous
     * in upstream ventojs@^2.3.1; the lint pipeline relies on `SourceError`
     * being thrown at parse time so it can map `multi-message:*` tags to
     * `vento.message-*` lint diagnostics without executing the template.
     *
     * Pin: signature mirrors `Environment.compile` from
     * `ventojs/core/environment.d.ts`. The companion test at
     * `tests/writer/vendor/ventojs_compile_test.ts` fails fast if this drifts.
     */
    compile(
      source: string,
      path?: string,
      defaults?: Record<string, unknown>,
    ): VentoTemplate;
  }
  export default function vento(options?: Record<string, unknown>): VentoEnvironment;
}
