// ─────────────────────────────────────────────────────────────────────────────
// Lorebook (Character Book) — V2 spec, carried forward in V3
// ─────────────────────────────────────────────────────────────────────────────

export interface CharacterBookEntry {
  /** Trigger keywords for this entry. */
  keys: string[];
  /** The text content injected into the prompt. */
  content: string;
  /** For application-specific data. Must not destroy unknown keys. */
  extensions: Record<string, unknown>;
  enabled: boolean;
  /** Lower value = inserted higher in context when budget is tight. */
  insertion_order: number;
  /** If true, a key from both `keys` AND `secondary_keys` must match. */
  selective?: boolean;
  secondary_keys?: string[];
  /** If true, always inserted regardless of keyword match (within budget). */
  constant?: boolean;
  /** Where the entry is placed relative to the character definitions. */
  position?: "before_char" | "after_char";
  // Optional display/organisational fields (not used in prompt engineering)
  name?: string;
  comment?: string;
  id?: number;
  priority?: number;
  case_sensitive?: boolean;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  /** How many recent chat messages to scan for keyword matches. */
  scan_depth?: number;
  /** Maximum tokens the lorebook may consume. */
  token_budget?: number;
  /** Whether a matched entry's content can trigger other entries. */
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export const DEFAULT_LOREBOOK_ENTRY: CharacterBookEntry = {
  keys: [],
  content: "",
  extensions: {},
  enabled: true,
  insertion_order: 100,
  selective: false,
  secondary_keys: [],
  constant: false,
  position: "before_char",
};

// ─────────────────────────────────────────────────────────────────────────────
// PhysicalAppearance — structured breakdown stored in extensions.appearance
// Composed into the V2 `description` field on export.
// ─────────────────────────────────────────────────────────────────────────────

export interface PhysicalAppearance {
  /** Gender identity / expression (e.g. "female", "non-binary") */
  gender: string;
  /** Overall build and body type (e.g. "tall, athletic") */
  build: string;
  /** Age and apparent age (e.g. "mid-30s, looks younger") */
  age: string;
  /** Hair — colour, length, texture, style */
  hair: string;
  /** Eyes — colour, shape, notable features */
  eyes: string;
  /** Skin — tone, texture, complexion */
  skin: string;
  /** Face — shape, jaw, cheekbones, notable features */
  face: string;
  /** Distinguishing marks — scars, tattoos, piercings, birthmarks */
  distinguishing_marks: string;
  /** Typical clothing and style */
  clothing_style: string;
  /** Voice — tone, accent, speech patterns */
  voice: string;
  /** General backstory / history / lore */
  backstory: string;
}

export const DEFAULT_APPEARANCE: PhysicalAppearance = {
  gender: "",
  build: "",
  age: "",
  hair: "",
  eyes: "",
  skin: "",
  face: "",
  distinguishing_marks: "",
  clothing_style: "",
  voice: "",
  backstory: "",
};

/**
 * Composes a PhysicalAppearance object into a single prose `description` string
 * suitable for the CCv3 `description` field.
 */
export function composeDescription(a: PhysicalAppearance): string {
  const parts: string[] = [];

  if (a.gender)           parts.push(`Gender: ${a.gender}`);
  if (a.build || a.age) {
    const line = [a.age && `Age: ${a.age}`, a.build && `Build: ${a.build}`]
      .filter(Boolean).join(" | ");
    parts.push(line);
  }
  if (a.face)                parts.push(`Face: ${a.face}`);
  if (a.hair)                parts.push(`Hair: ${a.hair}`);
  if (a.eyes)                parts.push(`Eyes: ${a.eyes}`);
  if (a.skin)                parts.push(`Skin: ${a.skin}`);
  if (a.distinguishing_marks) parts.push(`Distinguishing marks: ${a.distinguishing_marks}`);
  if (a.clothing_style)      parts.push(`Clothing & style: ${a.clothing_style}`);
  if (a.voice)               parts.push(`Voice: ${a.voice}`);
  if (a.backstory)           parts.push(`\n${a.backstory}`);

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// CharacterCard — superset of V2 + all V3 additions
// ─────────────────────────────────────────────────────────────────────────────

export interface CharacterCard {
  // ── V1 core fields ──────────────────────────────────────────────────────
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;

  // ── V2 additions ────────────────────────────────────────────────────────
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  /** For application-specific data. Must be preserved on round-trip. */
  extensions: Record<string, unknown>;
  character_book?: CharacterBook;

  // ── V3 additions ────────────────────────────────────────────────────────
  /** If set, replaces {{char}} / <char> / <bot> in prompts instead of `name`. */
  nickname?: string;
  /** Per-language creator notes. Key = ISO 639-1 language code. */
  creator_notes_multilingual?: Record<string, string>;
  /** Source IDs / URLs for the card's origin. Append-only; do not let users delete. */
  source?: string[];
  /** Additional first messages used only in group chats. */
  group_only_greetings: string[];
  /** Unix timestamp (seconds) when the card was first created. */
  creation_date?: number;
  /** Unix timestamp (seconds) when the card was last exported/modified. */
  modification_date?: number;

  // ── App-internal field (never exported) ─────────────────────────────────
  /** Base64 data URL of the character portrait. Stored as the PNG image on PNG export. */
  avatar?: string;
}

export const DEFAULT_CHARACTER: CharacterCard = {
  name: "",
  description: "",
  personality: "",
  scenario: "",
  first_mes: "",
  mes_example: "",
  creator_notes: "",
  system_prompt: "",
  post_history_instructions: "",
  alternate_greetings: [],
  tags: [],
  creator: "",
  character_version: "1.0.0",
  extensions: { appearance: { ...DEFAULT_APPEARANCE } },
  group_only_greetings: [],
};
