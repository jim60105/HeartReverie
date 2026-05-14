// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Hook Inspector type definitions. Shared by the HTTP route response, the
// dispatcher introspection contract, the conflict-detection library, and
// the `hook-inspector:report` typed event payload.

export interface HandlerInfo {
  readonly plugin: string | undefined;
  readonly priority: number;
  readonly errorCount: number;
  /** Manifest-declared reads, if any. */
  readonly reads?: readonly string[];
  /** Manifest-declared writes, if any. */
  readonly writes?: readonly string[];
  /** Manifest-declared free-form note, if any. */
  readonly note?: string;
}

export interface PipelineFieldRef {
  readonly stage: string;
  readonly field: string;
}

export interface ManifestHookDeclaration {
  readonly stage: string;
  readonly priority?: number;
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly note?: string;
}

export interface ManifestDeclarations {
  readonly plugin: string;
  readonly hooks: readonly ManifestHookDeclaration[];
}

export interface StripTagDeclaration {
  readonly plugin: string;
  readonly tags: readonly string[];
  readonly scope: "prompt+display" | "prompt" | "display";
}

/** Conflict heuristic identifiers. */
export type ConflictKind =
  | "C1-multi-write"
  | "C2-stale-read"
  | "C3-same-priority"
  | "C4-runtime-error";

export interface ConflictReport {
  readonly kind: ConflictKind;
  readonly stage: string;
  readonly field?: string;
  readonly plugins: readonly string[];
  readonly priorities?: readonly number[];
  readonly message: string;
}

/**
 * Payload dispatched on the `hook-inspector:report` frontend stage after
 * every conflict-detection pass.
 */
export interface HookInspectorReport {
  readonly backend: Record<string, readonly HandlerInfo[]>;
  readonly frontend: Record<string, readonly HandlerInfo[]>;
  readonly manifestDeclarations: readonly ManifestDeclarations[];
  readonly stripTags: readonly StripTagDeclaration[];
  readonly pipelineFields: readonly PipelineFieldRef[];
  readonly conflicts: readonly ConflictReport[];
  readonly bootMismatches: readonly BootMismatch[];
  readonly generatedAt: string;
}

export interface BootMismatch {
  readonly plugin: string;
  readonly declaredOnly: readonly string[];
  readonly registeredOnly: readonly string[];
}
