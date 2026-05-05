// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SillyTavern character card type definitions and the normalised
// `ParsedCharacterCard` shape produced by `character-card-parser.ts`.

export interface CharacterBookEntry {
  name?: string;
  keys?: string[];
  content?: string;
  // Other fields (extensions, position, etc.) are intentionally ignored —
  // we collapse to a markdown body and don't preserve provider-specific blobs.
}

export interface CharacterBook {
  entries?: CharacterBookEntry[];
  // V3 adds extra metadata; we don't render it.
}

export interface TavernCardV2Data {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  character_book?: CharacterBook;
  tags?: string[];
  creator?: string;
  character_version?: string;
  extensions?: Record<string, unknown>;
}

export interface TavernCardV2 {
  spec: "chara_card_v2";
  spec_version: string;
  data: TavernCardV2Data;
}

export interface TavernCardV3 {
  spec: "chara_card_v3";
  spec_version: string;
  data: TavernCardV2Data; // V3 superset; we treat V2 fields as authoritative.
}

export interface ParsedBookEntry {
  name: string;
  keys: string[];
  content: string;
}

export interface ParsedCharacterCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;
  bookEntries: ParsedBookEntry[];
}
