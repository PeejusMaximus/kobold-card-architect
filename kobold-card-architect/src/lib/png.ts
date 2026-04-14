/**
 * png.ts — Pure browser-native PNG chunk reader / writer. Zero dependencies.
 *
 * SillyTavern / KoboldLite character card PNG format
 * ───────────────────────────────────────────────────
 * A standard PNG file with an extra tEXt chunk whose keyword is "chara".
 * The chunk value is the card JSON encoded as UTF-8 then base64-encoded.
 *
 * V3 cards use keyword "ccv3" instead; we read both and prefer "ccv3".
 *
 * PNG chunk wire format (all integers big-endian):
 *   [4 bytes: data length] [4 bytes: ASCII type] [N bytes: data] [4 bytes: CRC32]
 *
 * tEXt chunk data layout:
 *   [keyword bytes] [0x00 null separator] [text bytes (Latin-1)]
 */

// ─────────────────────────────────────────────────────────────────────────────
// CRC32 — required for PNG chunk integrity
// ─────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const utf8 = new TextEncoder();
const latin1 = new TextDecoder("latin1");
const utf8dec = new TextDecoder("utf-8");

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset]     = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8)  & 0xff;
  buf[offset + 3] =  value         & 0xff;
}

function isPng(buf: Uint8Array): boolean {
  if (buf.length < 8) return false;
  return PNG_SIGNATURE.every((b, i) => buf[i] === b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunk iteration
// ─────────────────────────────────────────────────────────────────────────────

interface PngChunk {
  type: string;
  /** Byte offset of the chunk's data field within the full buffer. */
  dataOffset: number;
  dataLength: number;
  /** Byte offset of the chunk's 4-byte length field (start of the whole chunk). */
  chunkStart: number;
}

function listChunks(buf: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = 8; // skip PNG signature
  while (offset + 12 <= buf.length) {
    const dataLength = readUint32BE(buf, offset);
    const type = latin1.decode(buf.slice(offset + 4, offset + 8));
    chunks.push({
      type,
      dataOffset: offset + 8,
      dataLength,
      chunkStart: offset,
    });
    offset += 4 + 4 + dataLength + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: read character card JSON from a PNG buffer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the character card data embedded in a PNG's tEXt chunk.
 *
 * Supports:
 *  - "chara"  keyword  (SillyTavern V1 / V2, KoboldLite)
 *  - "ccv3"   keyword  (Character Card V3 spec) — preferred when both present
 *
 * The SillyTavern V2 `{ spec, data: { ... } }` wrapper is unwrapped
 * automatically so callers always receive the flat card fields.
 *
 * @throws {Error} if the buffer is not a PNG, has no character chunk, or
 *                 contains malformed base64 / JSON.
 */
export function readCardFromPng(buffer: ArrayBuffer): Record<string, unknown> {
  const buf = new Uint8Array(buffer);

  if (!isPng(buf)) {
    throw new Error("Not a valid PNG file.");
  }

  const chunks = listChunks(buf);
  let charaB64: string | null = null;
  let foundCcv3 = false;

  for (const chunk of chunks) {
    if (chunk.type !== "tEXt") continue;

    const data = buf.slice(chunk.dataOffset, chunk.dataOffset + chunk.dataLength);
    const nullIdx = data.indexOf(0);
    if (nullIdx === -1) continue;

    const keyword = utf8dec.decode(data.slice(0, nullIdx));
    // tEXt text field is Latin-1; base64 is ASCII-safe so either decoder works
    const text = latin1.decode(data.slice(nullIdx + 1));

    if (keyword === "ccv3") {
      charaB64 = text;
      foundCcv3 = true;
      break; // V3 preferred — stop looking
    }
    if (keyword === "chara" && !foundCcv3) {
      charaB64 = text;
      // keep scanning in case ccv3 appears later
    }
  }

  if (!charaB64) {
    throw new Error(
      "No character data found in this PNG.\n\nMake sure it was exported from SillyTavern, KoboldLite, or Kobold Card Architect."
    );
  }

  // base64 → raw bytes → UTF-8 decode → JSON
  let jsonStr: string;
  try {
    const binaryStr = atob(charaB64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    jsonStr = utf8dec.decode(bytes);
  } catch {
    throw new Error("Failed to decode the base64 character data from the PNG.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("The character data embedded in this PNG is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Character data in PNG is not a JSON object.");
  }

  // Unwrap SillyTavern V2 envelope: { spec: "chara_card_v2", data: { ... } }
  const p = parsed as Record<string, unknown>;
  if (p.spec && p.data && typeof p.data === "object") {
    return p.data as Record<string, unknown>;
  }

  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: write character card JSON into a PNG buffer
// ─────────────────────────────────────────────────────────────────────────────

/** @see writeCardToPng */
/** Encode a JSON string to base64 via UTF-8 bytes. */
function jsonToBase64(json: string): string {
  const bytes = utf8.encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Build a single PNG tEXt chunk for the given keyword and base64 payload. */
function buildTextChunk(keyword: string, b64: string): Uint8Array {
  const keywordBytes = utf8.encode(keyword);
  const textBytes    = utf8.encode(b64);
  const chunkData    = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData[keywordBytes.length] = 0x00;
  chunkData.set(textBytes, keywordBytes.length + 1);

  const typeBytes = utf8.encode("tEXt");
  const crcInput  = new Uint8Array(typeBytes.length + chunkData.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkData, typeBytes.length);
  const checksum = crc32(crcInput);

  const chunk = new Uint8Array(4 + 4 + chunkData.length + 4);
  writeUint32BE(chunk, 0, chunkData.length);
  chunk.set(typeBytes, 4);
  chunk.set(chunkData, 8);
  writeUint32BE(chunk, 8 + chunkData.length, checksum);
  return chunk;
}

/**
 * Embed character card data into a PNG as BOTH a CCv3 `ccv3` tEXt chunk and a
 * legacy V2 `chara` tEXt chunk, exactly as required by the CCv3 specification.
 *
 * - `ccv3JsonStr`  — full CCv3 envelope: `{ spec: "chara_card_v3", spec_version: "3.0", data: {...} }`
 * - `charaJsonStr` — V2 backfill:        `{ spec: "chara_card_v2", spec_version: "2.0", data: {...} }`
 *
 * Any pre-existing `chara` / `ccv3` tEXt chunks are removed first. Both new
 * chunks are injected immediately before the first IDAT chunk.
 *
 * @throws {Error} if `imageBuffer` is not a valid PNG.
 */
export function writeCardToPng(
  imageBuffer: ArrayBuffer,
  ccv3JsonStr: string,
  charaJsonStr: string,
): Uint8Array {
  const buf = new Uint8Array(imageBuffer);
  if (!isPng(buf)) throw new Error("Provided image buffer is not a valid PNG.");

  const ccv3Chunk  = buildTextChunk("ccv3",  jsonToBase64(ccv3JsonStr));
  const charaChunk = buildTextChunk("chara", jsonToBase64(charaJsonStr));

  const chunks = listChunks(buf);
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  let injected = false;

  for (const chunk of chunks) {
    const totalLen = 4 + 4 + chunk.dataLength + 4;
    const chunkBuf = buf.slice(chunk.chunkStart, chunk.chunkStart + totalLen);

    // Strip existing character data chunks
    if (chunk.type === "tEXt") {
      const data    = buf.slice(chunk.dataOffset, chunk.dataOffset + chunk.dataLength);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const kw = utf8dec.decode(data.slice(0, nullIdx));
        if (kw === "chara" || kw === "ccv3") continue;
      }
    }

    // Inject both chunks immediately before the first IDAT
    if (chunk.type === "IDAT" && !injected) {
      parts.push(ccv3Chunk, charaChunk);
      injected = true;
    }

    parts.push(chunkBuf);
  }

  // Safety fallback: insert before IEND if no IDAT was found
  if (!injected && parts.length > 1) {
    parts.splice(parts.length - 1, 0, ccv3Chunk, charaChunk);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const output = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of parts) { output.set(part, pos); pos += part.length; }
  return output;
}
