/**
 * cardio.ts — High-level character card import / export helpers.
 *
 * Supported formats
 * ─────────────────
 *  Import  →  JSON (.json)  |  PNG card (.png)
 *  Export  →  JSON (.json)  |  PNG card (.png)
 *
 * Export format compliance
 * ────────────────────────
 *  JSON → CCv3 envelope  { spec: "chara_card_v3", spec_version: "3.0", data: {...} }
 *  PNG  → `ccv3` tEXt chunk  (CCv3 full envelope)  — primary
 *         `chara` tEXt chunk (V2 backfill envelope) — for legacy readers
 *
 * The `avatar` field is stripped from all exported JSON payloads; on PNG
 * export the avatar is the image itself.
 */

import { CharacterCard, CharacterBook, DEFAULT_CHARACTER, DEFAULT_APPEARANCE, composeDescription, PhysicalAppearance } from "@/src/types";
import { readCardFromPng, writeCardToPng } from "@/src/lib/png";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Trigger a browser file download without opening a new tab. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Stamp `creation_date` (once, if missing) and `modification_date` (always)
 * on the card data object before building export payloads.
 * Returns a plain object ready for JSON serialisation — `avatar` is stripped.
 */
function prepareDataForExport(card: CharacterCard): Record<string, unknown> {
  const { avatar: _avatar, ...rest } = card; // _avatar intentionally unused — stripped from export
  const now = Math.floor(Date.now() / 1000);
  return {
    ...rest,
    creation_date:     rest.creation_date ?? now,
    modification_date: now,
  };
}

/** Serialise the card as a CCv3 envelope JSON string. */
function buildCcv3Json(card: CharacterCard): string {
  const data = prepareDataForExport(card);
  return JSON.stringify(
    { spec: "chara_card_v3", spec_version: "3.0", data },
    null,
    2
  );
}

/**
 * Serialise the card as a V2 backfill envelope JSON string.
 * V3-only fields are omitted so legacy readers don't choke on unknown keys.
 * Per the CCv3 spec the `creator_notes` field SHOULD receive a warning note.
 */
function buildCharaV2Json(card: CharacterCard): string {
  // V3-only fields are destructured out and intentionally discarded for the V2 backfill
  const { avatar: _a, nickname: _n, creator_notes_multilingual: _cnm,
          source: _s, group_only_greetings: _gog, creation_date: _cd,
          modification_date: _md, ...v2Fields } = card;

  const now = Math.floor(Date.now() / 1000);
  const data: Record<string, unknown> = {
    ...v2Fields,
    // Spec-required backfill note
    creator_notes:
      "[CCv3 card — load in a CCv3-compatible app for full features]\n" +
      (card.creator_notes ?? ""),
    creation_date:     card.creation_date ?? now,
    modification_date: now,
    extensions: card.extensions ?? {},
  };

  return JSON.stringify(
    { spec: "chara_card_v2", spec_version: "2.0", data },
    null,
    2
  );
}

/** Fetch a data URL and return its binary content as an ArrayBuffer. */
async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error("Failed to load avatar data URL.");
  return res.arrayBuffer();
}

/**
 * Render a styled placeholder card portrait on an off-screen <canvas> and
 * return it as a PNG ArrayBuffer.  Used when the user hasn't uploaded an avatar.
 */
async function makePlaceholderPng(card: CharacterCard): Promise<ArrayBuffer> {
  const W = 400;
  const H = 600;

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");

  // ── Background ─────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0f0f1a");
  bg.addColorStop(1, "#1a1030");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle radial glow
  const glow = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, W * 0.65);
  glow.addColorStop(0, "rgba(99,102,241,0.28)");
  glow.addColorStop(1, "rgba(99,102,241,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Fine dot-grid overlay
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let x = 0; x < W; x += 20) {
    for (let y = 0; y < H; y += 20) {
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // ── Avatar circle ──────────────────────────────────────────────────────────
  const cx = W / 2;
  const cy = H * 0.35;
  const r  = 90;

  // Outer glow ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(99,102,241,0.18)";
  ctx.lineWidth   = 12;
  ctx.stroke();

  // Circle fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(99,102,241,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(99,102,241,0.55)";
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Initial letter
  const initial = card.name ? card.name[0].toUpperCase() : "?";
  ctx.fillStyle    = "rgba(139,141,255,0.75)";
  ctx.font         = `bold ${r * 0.9}px sans-serif`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial, cx, cy);

  // ── Name ───────────────────────────────────────────────────────────────────
  ctx.fillStyle    = "#ffffff";
  ctx.font         = "bold 26px sans-serif";
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";
  const name = card.name || "Unnamed Character";
  ctx.fillText(name, W / 2, cy + r + 28);

  // ── Creator ────────────────────────────────────────────────────────────────
  if (card.creator) {
    ctx.fillStyle    = "rgba(255,255,255,0.45)";
    ctx.font         = "13px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`by ${card.creator}`, W / 2, cy + r + 62);
  }

  // ── Tags strip ─────────────────────────────────────────────────────────────
  const visibleTags = card.tags.slice(0, 4);
  if (visibleTags.length > 0) {
    let totalTagW = 0;
    const tagPadX = 10;
    const tagH    = 20;
    const tagGap  = 6;
    ctx.font = "11px sans-serif";
    const tagWidths = visibleTags.map((t) => ctx.measureText(t).width + tagPadX * 2);
    totalTagW = tagWidths.reduce((s, w) => s + w, 0) + tagGap * (visibleTags.length - 1);

    let tx = (W - totalTagW) / 2;
    const ty = H - 90;

    for (let i = 0; i < visibleTags.length; i++) {
      const tw = tagWidths[i];
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, tagH, 4);
      ctx.fillStyle = "rgba(99,102,241,0.25)";
      ctx.fill();
      ctx.strokeStyle = "rgba(99,102,241,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle    = "rgba(200,200,255,0.85)";
      ctx.textAlign    = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(visibleTags[i], tx + tagPadX, ty + tagH / 2);
      tx += tw + tagGap;
    }
  }

  // ── Version badge ──────────────────────────────────────────────────────────
  if (card.character_version) {
    const vText = `v${card.character_version}`;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    const vw = ctx.measureText(vText).width + 16;
    const vh = 20;
    const vx = W / 2 - vw / 2;
    const vy = H - 52;
    ctx.beginPath();
    ctx.roundRect(vx, vy, vw, vh, 4);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();
    ctx.fillStyle    = "rgba(255,255,255,0.5)";
    ctx.textBaseline = "middle";
    ctx.fillText(vText, W / 2, vy + vh / 2);
  }

  // ── Bottom border line ─────────────────────────────────────────────────────
  const bottomGrad = ctx.createLinearGradient(0, 0, W, 0);
  bottomGrad.addColorStop(0,   "rgba(99,102,241,0)");
  bottomGrad.addColorStop(0.5, "rgba(99,102,241,0.6)");
  bottomGrad.addColorStop(1,   "rgba(99,102,241,0)");
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, H - 3, W, 3);

  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("canvas.toBlob() returned null.")); return; }
      blob.arrayBuffer().then(resolve).catch(reject);
    }, "image/png");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: Import
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unwrap a V2 or V3 spec envelope and normalise the inner `data` object into
 * a `CharacterCard`-shaped plain object.  Unknown keys are preserved so they
 * can be round-tripped through `extensions` on export.
 */
function normaliseRawCard(raw: Record<string, unknown>): Record<string, unknown> {
  // Unwrap CCv3 or V2 spec envelopes
  const data: Record<string, unknown> =
    (raw.spec === "chara_card_v3" || raw.spec === "chara_card_v2") &&
    raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
      ? (raw.data as Record<string, unknown>)
      : raw;

  // Normalise arrays that must always exist
  if (!Array.isArray(data.alternate_greetings))  data.alternate_greetings  = [];
  if (!Array.isArray(data.tags))                 data.tags                 = [];
  if (!Array.isArray(data.group_only_greetings)) data.group_only_greetings = [];
  if (!data.extensions || typeof data.extensions !== "object") data.extensions = {};

  // Ensure extensions.appearance exists.
  // For legacy cards that only have a flat `description`, seed backstory from it
  // so the structured fields are pre-populated rather than blank.
  const ext = data.extensions as Record<string, unknown>;
  if (!ext.appearance || typeof ext.appearance !== "object") {
    const legacyDesc = typeof data.description === "string" ? data.description : "";
    const seeded: PhysicalAppearance = { ...DEFAULT_APPEARANCE, backstory: legacyDesc };
    ext.appearance = seeded;
    // Also rewrite description through the composer so it's consistent
    data.description = composeDescription(seeded);
  }

  // Normalise character_book entries if present
  if (data.character_book && typeof data.character_book === "object") {
    const book = data.character_book as Record<string, unknown>;
    if (!Array.isArray(book.entries)) book.entries = [];
    if (!book.extensions || typeof book.extensions !== "object") book.extensions = {};
  }

  return data;
}

/**
 * Import a character card from a `.json` file.
 *
 * Handles:
 *  - CCv3 envelope: `{ spec: "chara_card_v3", spec_version: "3.0", data: {...} }`
 *  - V2 envelope:   `{ spec: "chara_card_v2", spec_version: "2.0", data: {...} }`
 *  - Plain flat card objects (V1 / legacy)
 */
export async function importCardFromJson(file: File): Promise<CharacterCard> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON file does not contain a valid character card object.");
  }

  const data = normaliseRawCard(parsed as Record<string, unknown>);
  return { ...DEFAULT_CHARACTER, ...data } as CharacterCard;
}

/**
 * Import a character card from a `.png` card file.
 *
 * Returns both the merged CharacterCard and the original PNG as a data URL
 * so the editor can display the actual embedded portrait.
 */
export async function importCardFromPng(
  file: File
): Promise<{ card: CharacterCard; avatarDataUrl: string }> {
  const buffer = await file.arrayBuffer();

  // readCardFromPng already unwraps any V2/V3 envelope
  const raw  = readCardFromPng(buffer);
  const data = normaliseRawCard(raw);

  const avatarDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read PNG file as data URL."));
    reader.readAsDataURL(file);
  });

  const card: CharacterCard = {
    ...DEFAULT_CHARACTER,
    ...(data as Partial<CharacterCard>),
    avatar: avatarDataUrl,
  };

  return { card, avatarDataUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export a character card as a CCv3-compliant `.json` file.
 * The emitted JSON is a full CCv3 envelope:
 *   `{ spec: "chara_card_v3", spec_version: "3.0", data: { ... } }`
 */
export function exportCardAsJson(card: CharacterCard): void {
  const json = buildCcv3Json(card);
  const blob = new Blob([json], { type: "application/json" });
  triggerDownload(blob, `${card.name || "character"}.json`);
}

/**
 * Export the card's embedded lorebook as a standalone KoboldLite-compatible
 * world info JSON file.
 *
 * KoboldLite's "Import All" button in the World Info panel expects:
 *   `{ "worldinfo": [ { uid, key, keysecondary, content, comment, folder, num, selective, constant, wep }, ... ] }`
 *
 * Field mapping from CCv3 CharacterBookEntry → KoboldLite worldinfo entry:
 *   keys (array)          → key          (comma-joined string)
 *   secondary_keys (array)→ keysecondary (comma-joined string)
 *   content               → content
 *   name / comment        → comment
 *   insertion_order       → num
 *   selective             → selective
 *   constant              → constant
 *   position              → wep  ("after_char" = true, "before_char" = false)
 *   id                    → uid
 */
export function exportLorebookAsJson(book: CharacterBook, cardName?: string): void {
  const entries = book.entries.map((entry, i) => ({
    uid:          entry.id ?? i,
    key:          entry.keys.join(", "),
    keysecondary: (entry.secondary_keys ?? []).join(", "),
    content:      entry.content,
    comment:      entry.name ?? entry.comment ?? "",
    folder:       null,
    num:          entry.insertion_order,
    selective:    entry.selective ?? false,
    constant:     entry.constant ?? false,
    wep:          entry.position === "after_char",
  }));

  const json = JSON.stringify({ worldinfo: entries }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const stem = cardName ? `${cardName}_worldinfo` : "worldinfo";
  triggerDownload(blob, `${stem}.json`);
}

/**
 * Export a character card as a CCv3-compliant `.png` file.
 *
 * Two tEXt chunks are embedded (as required by the CCv3 spec):
 *   - `ccv3`  — full CCv3 envelope  (primary, for V3-aware readers)
 *   - `chara` — V2 backfill envelope (for legacy SillyTavern / KoboldLite)
 *
 * The base image is `card.avatar` (user-uploaded portrait) or a generated
 * styled placeholder when no avatar has been set.
 */
export async function exportCardAsPng(card: CharacterCard): Promise<void> {
  let imageBuffer: ArrayBuffer;

  if (card.avatar) {
    try {
      imageBuffer = await dataUrlToArrayBuffer(card.avatar);
    } catch {
      imageBuffer = await makePlaceholderPng(card);
    }
  } else {
    imageBuffer = await makePlaceholderPng(card);
  }

  const ccv3Json  = buildCcv3Json(card);
  const charaJson = buildCharaV2Json(card);
  const pngBytes  = writeCardToPng(imageBuffer, ccv3Json, charaJson);
  const pngBuffer = pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength);
  const blob       = new Blob([pngBuffer], { type: "image/png" });

  triggerDownload(blob, `${card.name || "character"}.png`);
}
