// Ambient type declarations for ventojs@^2.3.1
// Pin: update when upgrading ventojs version
declare module "ventojs" {
  export interface VentoEnvironment {
    run(template: string, data: Record<string, unknown>): Promise<{ content: string }>;
    runString(template: string, data: Record<string, unknown>): Promise<{ content: string }>;
    load(path: string): Promise<{ source: string }>;
  }
  export default function vento(options?: Record<string, unknown>): VentoEnvironment;
}
