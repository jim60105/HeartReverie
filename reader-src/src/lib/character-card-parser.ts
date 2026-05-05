// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Client-side SillyTavern character-card PNG parser.
//
// PNG layout: 8-byte signature, then a sequence of chunks, each
//   length(4) | type(4) | data(length) | crc(4)
// terminated by an `IEND` chunk. SillyTavern stores the character JSON
// inside `tEXt` chunks whose data is `keyword\0base64-of-JSON`.
//
// Two keywords are relevant: `chara` (V2) and `ccv3` (V3). When both are
// present, V3 wins.

import type {
  ParsedBookEntry,
  ParsedCharacterCard,
  TavernCardV2Data,
} from "@/types/character-card";

const MAX_FILE_BYTES = 16 * 1024 * 1024; // 16 MiB
const MAX_BOOK_ENTRIES = 1000;
const PNG_SIGNATURE = [
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
] as const;

interface TextChunk {
  keyword: string;
  text: string;
}

function isPng(view: DataView): boolean {
  if (view.byteLength < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

/**
 * Walk PNG chunks and collect every `tEXt` chunk's `(keyword, text)` pair.
 * Throws `"PNG 區塊不完整"` if any chunk header claims a length that would
 * extend past the end of the buffer.
 */
function collectTextChunks(view: DataView): TextChunk[] {
  const chunks: TextChunk[] = [];
  let offset: number = PNG_SIGNATURE.length;
  const total = view.byteLength;

  while (offset + 8 <= total) {
    const length = view.getUint32(offset, false);
    const type = readAscii(view, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4; // include CRC

    if (chunkEnd > total) {
      throw new Error("PNG 區塊不完整");
    }

    if (type === "tEXt") {
      // tEXt data: keyword\0text  (keyword is 1..79 bytes Latin-1)
      let nullIdx = -1;
      for (let i = 0; i < length; i++) {
        if (view.getUint8(dataStart + i) === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx > 0) {
        const keyword = readAscii(view, dataStart, nullIdx);
        const textLen = length - nullIdx - 1;
        const text = readAscii(view, dataStart + nullIdx + 1, textLen);
        chunks.push({ keyword, text });
      }
    }

    if (type === "IEND") break;
    offset = chunkEnd;
  }

  return chunks;
}

function tryDecodeJson(base64: string): TavernCardV2Data | null {
  let json: string;
  try {
    json = atob(base64);
  } catch {
    return null;
  }
  // atob returns latin-1; the underlying bytes are UTF-8 — re-decode.
  try {
    const bytes = new Uint8Array(json.length);
    for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i) & 0xff;
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const parsed = JSON.parse(utf8) as { data?: unknown };
    if (parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object") {
      return parsed.data as TavernCardV2Data;
    }
    // Some malformed cards put fields at the top level.
    if (parsed && typeof parsed === "object") {
      return parsed as TavernCardV2Data;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function normalise(data: TavernCardV2Data): ParsedCharacterCard {
  const entries = data.character_book?.entries ?? [];
  if (entries.length > MAX_BOOK_ENTRIES) {
    throw new Error("character_book.entries 超過 1000 筆，無法匯入");
  }
  const bookEntries: ParsedBookEntry[] = entries.map((entry) => {
    const keys = asStringArray(entry?.keys);
    const name = asString(entry?.name) || keys[0] || "";
    return {
      name,
      keys,
      content: asString(entry?.content),
    };
  });
  return {
    name: asString(data.name),
    description: asString(data.description),
    personality: asString(data.personality),
    scenario: asString(data.scenario),
    firstMes: asString(data.first_mes),
    mesExample: asString(data.mes_example),
    creatorNotes: asString(data.creator_notes),
    systemPrompt: asString(data.system_prompt),
    postHistoryInstructions: asString(data.post_history_instructions),
    alternateGreetings: asStringArray(data.alternate_greetings),
    tags: asStringArray(data.tags),
    creator: asString(data.creator),
    characterVersion: asString(data.character_version),
    bookEntries,
  };
}

export async function parseCharacterCard(
  file: File | Blob,
): Promise<ParsedCharacterCard> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("檔案過大（>16 MiB）");
  }
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  if (!isPng(view)) {
    throw new Error("Not a PNG file");
  }

  const chunks = collectTextChunks(view);

  let ccv3: string | null = null;
  let chara: string | null = null;
  for (const chunk of chunks) {
    if (chunk.keyword === "ccv3" && ccv3 === null) ccv3 = chunk.text;
    else if (chunk.keyword === "chara" && chara === null) chara = chunk.text;
  }

  if (ccv3 !== null) {
    const data = tryDecodeJson(ccv3);
    if (data) return normalise(data);
  }
  if (chara !== null) {
    const data = tryDecodeJson(chara);
    if (data) return normalise(data);
  }

  throw new Error("No SillyTavern character data found");
}
