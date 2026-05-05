import { parseCharacterCard } from "@/lib/character-card-parser";
import type { TavernCardV2Data } from "@/types/character-card";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  // CRC is not verified by the parser; pad with zeros.
  const crc = new Uint8Array(4);
  return concatBytes([len, ascii(type), data, crc]);
}

function tEXt(keyword: string, text: string): Uint8Array {
  const data = concatBytes([ascii(keyword), new Uint8Array([0]), ascii(text)]);
  return chunk("tEXt", data);
}

function ihdr(): Uint8Array {
  // minimal stub: 13 zero bytes (parser ignores contents)
  return chunk("IHDR", new Uint8Array(13));
}

function iend(): Uint8Array {
  return chunk("IEND", new Uint8Array(0));
}

function jsonToBase64(obj: unknown): string {
  const bytes = utf8(JSON.stringify(obj));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function buildPng(textChunks: Array<[string, string]>): File {
  const parts: Uint8Array[] = [PNG_SIGNATURE, ihdr()];
  for (const [k, v] of textChunks) parts.push(tEXt(k, v));
  parts.push(iend());
  return new File([concatBytes(parts).buffer as ArrayBuffer], "card.png", {
    type: "image/png",
  });
}

function v2Data(): TavernCardV2Data {
  return {
    name: "Alice V2",
    description: "v2-desc",
    personality: "v2-pers",
    scenario: "v2-scen",
    first_mes: "hi v2",
    mes_example: "ex v2",
    creator_notes: "v2-notes",
    system_prompt: "sysv2",
    post_history_instructions: "phv2",
    alternate_greetings: ["alt-a", "alt-b"],
    tags: ["t1", "t2"],
    creator: "creator-v2",
    character_version: "1.0",
  };
}

function v3Data(): TavernCardV2Data {
  return {
    name: "Alice V3",
    description: "v3-desc",
    personality: "v3-pers",
    scenario: "v3-scen",
    first_mes: "hi v3",
    mes_example: "ex v3",
    creator_notes: "v3-notes",
    system_prompt: "sysv3",
    post_history_instructions: "phv3",
    alternate_greetings: ["alt-c"],
    tags: ["t3"],
    creator: "creator-v3",
    character_version: "3.0",
    character_book: {
      entries: [
        { name: "Entry1", keys: ["k1", "k2"], content: "body1" },
        { name: "Entry2", keys: ["k3"], content: "body2" },
      ],
    },
  };
}

describe("parseCharacterCard", () => {
  it("hydrates from chara when only chara is present (V2)", async () => {
    const card = { spec: "chara_card_v2", spec_version: "2.0", data: v2Data() };
    const file = buildPng([["chara", jsonToBase64(card)]]);
    const parsed = await parseCharacterCard(file);
    expect(parsed.name).toBe("Alice V2");
    expect(parsed.description).toBe("v2-desc");
    expect(parsed.alternateGreetings).toEqual(["alt-a", "alt-b"]);
    expect(parsed.tags).toEqual(["t1", "t2"]);
    expect(parsed.bookEntries).toEqual([]);
  });

  it("hydrates from ccv3 when only ccv3 is present (V3)", async () => {
    const card = { spec: "chara_card_v3", spec_version: "3.0", data: v3Data() };
    const file = buildPng([["ccv3", jsonToBase64(card)]]);
    const parsed = await parseCharacterCard(file);
    expect(parsed.name).toBe("Alice V3");
    expect(parsed.bookEntries).toHaveLength(2);
    expect(parsed.bookEntries[0]!.keys).toEqual(["k1", "k2"]);
  });

  it("prefers V3 (ccv3) over V2 (chara) when both are present", async () => {
    const v2 = { spec: "chara_card_v2", spec_version: "2.0", data: v2Data() };
    const v3 = { spec: "chara_card_v3", spec_version: "3.0", data: v3Data() };
    const file = buildPng([
      ["chara", jsonToBase64(v2)],
      ["ccv3", jsonToBase64(v3)],
    ]);
    const parsed = await parseCharacterCard(file);
    expect(parsed.name).toBe("Alice V3");
    expect(parsed.description).toBe("v3-desc");
  });

  it("falls back to chara when ccv3 is malformed JSON", async () => {
    const v2 = { spec: "chara_card_v2", spec_version: "2.0", data: v2Data() };
    const garbageButValidBase64 = jsonToBase64("not-an-object-after-parse-ok") + "";
    // Base64 of a non-JSON string. We need ccv3 base64-decode to succeed but JSON.parse to fail.
    const malformed = btoa("this is not json {{{");
    const file = buildPng([
      ["ccv3", malformed],
      ["chara", jsonToBase64(v2)],
    ]);
    const parsed = await parseCharacterCard(file);
    expect(parsed.name).toBe("Alice V2");
    void garbageButValidBase64;
  });

  it("rejects when neither ccv3 nor chara is present", async () => {
    const file = buildPng([["other", jsonToBase64({ x: 1 })]]);
    await expect(parseCharacterCard(file)).rejects.toThrow(
      /No SillyTavern character data found/,
    );
  });

  it("rejects when chara is malformed base64 and no ccv3", async () => {
    const file = buildPng([["chara", "%%%not-base64%%%"]]);
    await expect(parseCharacterCard(file)).rejects.toThrow(
      /No SillyTavern character data found/,
    );
  });

  it("rejects non-PNG input", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5]).buffer as ArrayBuffer], "x.bin");
    await expect(parseCharacterCard(file)).rejects.toThrow(/Not a PNG file/);
  });

  it("rejects oversized files (>16 MiB) without reading them", async () => {
    const fakeBig = new File([], "big.png");
    Object.defineProperty(fakeBig, "size", { value: 16 * 1024 * 1024 + 1 });
    await expect(parseCharacterCard(fakeBig)).rejects.toThrow(/16 MiB/);
  });

  it("rejects truncated PNGs (chunk header extends past buffer)", async () => {
    const card = { spec: "chara_card_v2", spec_version: "2.0", data: v2Data() };
    const goodText = tEXt("chara", jsonToBase64(card));
    // Build a fake chunk header claiming an enormous data length, then truncate.
    const bigLen = new Uint8Array(4);
    new DataView(bigLen.buffer).setUint32(0, 0xffffff, false);
    const truncatedChunk = concatBytes([bigLen, ascii("tEXt"), new Uint8Array(10)]);
    const bytes = concatBytes([
      PNG_SIGNATURE,
      ihdr(),
      goodText,
      truncatedChunk,
    ]);
    const file = new File([bytes.buffer as ArrayBuffer], "trunc.png");
    await expect(parseCharacterCard(file)).rejects.toThrow(/PNG 區塊不完整/);
  });

  it("rejects character_book.entries beyond the safety cap", async () => {
    const data = v3Data();
    data.character_book = {
      entries: Array.from({ length: 1001 }, (_, i) => ({
        name: `e${i}`,
        keys: [`k${i}`],
        content: "x",
      })),
    };
    const card = { spec: "chara_card_v3", spec_version: "3.0", data };
    const file = buildPng([["ccv3", jsonToBase64(card)]]);
    await expect(parseCharacterCard(file)).rejects.toThrow(
      /character_book\.entries 超過 1000 筆/,
    );
  });

  it("normalises missing fields to empty strings/arrays", async () => {
    const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "X" } };
    const file = buildPng([["chara", jsonToBase64(card)]]);
    const parsed = await parseCharacterCard(file);
    expect(parsed.description).toBe("");
    expect(parsed.tags).toEqual([]);
    expect(parsed.alternateGreetings).toEqual([]);
    expect(parsed.bookEntries).toEqual([]);
  });

  it("character_book entries map to bookEntries", async () => {
    const card = { spec: "chara_card_v3", spec_version: "3.0", data: v3Data() };
    const file = buildPng([["ccv3", jsonToBase64(card)]]);
    const parsed = await parseCharacterCard(file);
    expect(parsed.bookEntries).toEqual([
      { name: "Entry1", keys: ["k1", "k2"], content: "body1" },
      { name: "Entry2", keys: ["k3"], content: "body2" },
    ]);
  });
});
