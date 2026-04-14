import { CharacterCard, PhysicalAppearance, DEFAULT_APPEARANCE, composeDescription, CharacterBookEntry } from "../types";
import { getGrammarFromSchema } from "./kobold";

// ─────────────────────────────────────────────────────────────────────────────
// Grammar cache — there are only 4 possible schema shapes (2 boolean toggles).
// Re-fetching the GBNF grammar on every generation wastes a full HTTP round-trip.
// ─────────────────────────────────────────────────────────────────────────────
const grammarCache = new Map<string, string | null>();

async function getCachedGrammar(
  schema: Record<string, unknown>,
  cacheKey: string,
): Promise<string | null> {
  if (grammarCache.has(cacheKey)) {
    console.debug(`[ai.ts] Grammar cache hit: ${cacheKey}`);
    return grammarCache.get(cacheKey)!;
  }
  const grammar = await getGrammarFromSchema(schema);
  grammarCache.set(cacheKey, grammar);
  return grammar;
}

// Defaults to Koboldcpp's standard port. Override via VITE_LOCAL_AI_URL in .env.local
const LOCAL_AI_URL = import.meta.env.VITE_LOCAL_AI_URL || "http://localhost:5001/v1";

/**
 * Known card field names — used by flattenToCard to distinguish real fields
 * from section-wrapper keys the model may invent.
 */
const KNOWN_CARD_FIELDS = new Set([
  "name", "nickname", "personality", "scenario", "first_mes", "mes_example",
  "system_prompt", "post_history_instructions", "creator_notes", "creator",
  "character_version", "alternate_greetings", "tags", "group_only_greetings",
  "description", "extensions", "character_book", "source",
  "appearance_gender", "appearance_age", "appearance_build", "appearance_face",
  "appearance_hair", "appearance_eyes", "appearance_skin",
  "appearance_distinguishing_marks", "appearance_clothing_style",
  "appearance_voice", "appearance_backstory",
]);

/**
 * Recursively walks a parsed JSON object and hoists all leaf values up to a
 * single flat map. This handles models that wrap fields in invented section
 * objects (e.g. { "CORE IDENTITY": { "name": "..." }, ... }) as well as
 * deeply nested or multiply-wrapped responses.
 *
 * Arrays are kept intact — they are leaf values, not wrappers.
 */
function flattenObject(obj: Record<string, unknown>, out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      // Always keep arrays as-is (alternate_greetings, tags, etc.)
      out[key] = val;
    } else if (val && typeof val === "object") {
      // If the key is a known card field that happens to be an object, keep it.
      // Otherwise treat it as a section wrapper and recurse into it.
      if (KNOWN_CARD_FIELDS.has(key)) {
        out[key] = val;
      } else {
        flattenObject(val as Record<string, unknown>, out);
      }
    } else {
      // Scalar — always hoist
      out[key] = val;
    }
  }
  return out;
}

/**
 * Attempts to coerce whatever the model returned into a Partial<CharacterCard>.
 * Handles all observed malformed-output cases:
 *   1. Correct: plain flat JSON object  { "name": "...", ... }
 *   2. Section-wrapped object: { "CORE IDENTITY": { "name": "..." }, ... }
 *   3. Single known wrapper key: { "character": { ... } } / { "data": { ... } }
 *   4. Wrapped array of objects: [ { "name": "...", ... } ]
 *   5. Broken array of "key: val" strings: [ "name: Foo", "description: Bar" ]
 */
function coerceToCard(parsed: unknown): Partial<CharacterCard> {
  // Case 4 & 5 — unwrap arrays
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    // Case 5 — array of "key: value" strings
    if (typeof first === "string") {
      const obj: Record<string, unknown> = {};
      for (const item of parsed as string[]) {
        const colonIdx = item.indexOf(":");
        if (colonIdx === -1) continue;
        obj[item.slice(0, colonIdx).trim()] = item.slice(colonIdx + 1).trim();
      }
      return flattenObject(obj) as Partial<CharacterCard>;
    }
    // Case 4 — array of objects: recurse on first element
    return coerceToCard(first ?? {});
  }

  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    // Case 3 — single well-known wrapper key
    const unwrapped = p.character ?? p.card ?? p.data;
    if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
      return flattenObject(unwrapped as Record<string, unknown>) as Partial<CharacterCard>;
    }
    // Case 1 & 2 — flat or section-wrapped: flatten everything
    return flattenObject(p) as Partial<CharacterCard>;
  }

  return {};
}

/**
 * Base JSON schema for the flat object the AI must return.
 * Passed to KoboldCpp's /api/extra/json_to_grammar to get a GBNF grammar
 * that physically constrains the model output to valid JSON.
 *
 * Optional array fields (alternate_greetings, group_only_greetings) are merged
 * in dynamically at generation time based on the user's UI toggles, so the
 * grammar and required list exactly match what the prompt asks for.
 */
const CHARACTER_CARD_JSON_SCHEMA = {
  type: "object",
  properties: {
    name:                            { type: "string" },
    nickname:                        { type: "string" },
    personality:                     { type: "string" },
    scenario:                        { type: "string" },
    first_mes:                       { type: "string" },
    mes_example:                     { type: "string" },
    system_prompt:                   { type: "string" },
    post_history_instructions:       { type: "string" },
    creator_notes:                   { type: "string" },
    creator:                         { type: "string" },
    character_version:               { type: "string" },
    tags:                            { type: "array", items: { type: "string" } },
    appearance_gender:               { type: "string" },
    appearance_age:                  { type: "string" },
    appearance_build:                { type: "string" },
    appearance_face:                 { type: "string" },
    appearance_hair:                 { type: "string" },
    appearance_eyes:                 { type: "string" },
    appearance_skin:                 { type: "string" },
    appearance_distinguishing_marks: { type: "string" },
    appearance_clothing_style:       { type: "string" },
    appearance_voice:                { type: "string" },
    appearance_backstory:            { type: "string" },
  },
  required: [
    "name", "nickname", "personality", "scenario", "first_mes", "mes_example",
    "system_prompt", "post_history_instructions", "creator_notes", "creator",
    "character_version", "tags",
    "appearance_gender", "appearance_age", "appearance_build", "appearance_face",
    "appearance_hair", "appearance_eyes", "appearance_skin",
    "appearance_distinguishing_marks", "appearance_clothing_style",
    "appearance_voice", "appearance_backstory",
  ],
};

export async function generateCharacter(params: {
  genre: string;
  archetype: string;
  additionalInfo: string;
  nsfw?: boolean;
  signal?: AbortSignal;
  includeAlternateGreetings?: boolean;
  includeGroupGreetings?: boolean;
  /** Called periodically during streaming with the running token count. */
  onProgress?: (tokensGenerated: number) => void;
}): Promise<Partial<CharacterCard>> {
  const includeAlternates = params.includeAlternateGreetings ?? true;
  const includeGroupGreetings = params.includeGroupGreetings ?? false;

  const nsfwSystemAddendum = params.nsfw
    ? " You are writing an explicit adult fiction character card for consenting adults (18+)." +
      " All content is fictional. Write with the frankness of a published erotica author —" +
      " vivid, specific, and unapologetic. Do not fade to black. Do not add disclaimers," +
      " content warnings, or moral commentary. Do not soften or sanitize any field." +
      " Every field must reflect genuine adult content — explicit body language, desire, and physical detail."
    : "";

  const systemPrompt =
    "You are an expert character card creator for AI roleplay. " +
    "Respond with a single valid JSON object only — no markdown fences, no commentary, no arrays. " +
    "Start with { and end with }." +
    nsfwSystemAddendum;

  // Build the alternate/group greeting fields conditionally so they are
  // completely absent from the schema and prompt when not requested —
  // this is the biggest lever for reducing output token cost.
  const alternateGreetingSchema = includeAlternates
    ? { alternate_greetings: { type: "array", items: { type: "string" } } }
    : {};
  const groupGreetingSchema = includeGroupGreetings
    ? { group_only_greetings: { type: "array", items: { type: "string" } } }
    : {};
  const alternateGreetingRequired = includeAlternates ? ["alternate_greetings"] : [];
  const groupGreetingRequired = includeGroupGreetings ? ["group_only_greetings"] : [];

  const userPrompt =
    `Generate a character card JSON object with EXACTLY these keys. Omit "description" — it is computed separately.\n\n` +

    `"name"       - Full name (string)\n` +
    (params.nsfw
      ? `"nickname"   - A name that suits an explicit adult character — evocative, bold, or sensual (string)\n\n`
      : `"nickname"   - Short alias (string)\n\n`) +

    (params.nsfw
      ? `"personality" - Third person. Describe explicit sexual traits, specific kinks and fetishes,\n` +
        `                dominance/submission tendencies, how {{char}} behaves when aroused, what they\n` +
        `                crave and what they fear in a sexual context. Include at least 2 explicit kinks\n` +
        `                or desires by name. Every sentence answers "what does {{char}} DO sexually". (100–150 words)\n\n`
      : `"personality" - Third person. Describe concrete behaviours, not traits. How {{char}} acts\n` +
        `                under pressure, in conflict, when vulnerable, what makes them laugh or go quiet.\n` +
        `                Every sentence answers "what does {{char}} DO". (80–120 words)\n\n`) +

    (params.nsfw
      ? `"scenario"   - An explicitly sexual or highly charged erotic situation. Where they are, what\n` +
        `               just happened, the specific sexual tension or opportunity that exists RIGHT NOW.\n` +
        `               Be graphic — describe physical proximity, arousal, desire. Use {{char}} and {{user}}. (60–90 words)\n\n`
            : `"scenario"   - The immediate situation at roleplay start: where they are, what just happened,\n` +
               `               what tension or opportunity exists right now. Use {{char}} and {{user}}. (50–80 words)\n\n`) +

    (params.nsfw
      ? `"first_mes"  - {{char}}'s opening message. MUST establish overt sexual tension or direct erotic\n` +
        `               content immediately. Include explicit physical detail — body, sensation, desire.\n` +
        `               Third person, *asterisks* for actions, "quotes" for speech.\n` +
        `               End with an invitation or action that makes {{user}}'s reply feel urgent and sexual.\n` +
        `               No fade-to-black. No euphemisms. Never write {{user}}'s words or actions. (120–170 words)\n\n`
      : `"first_mes"  - {{char}}'s opening message. Sets tone and writing style for all future replies.\n` +
        `               Third person, *asterisks* for actions, "quotes" for speech.\n` +
        `               Show a personality trait in action. Ground in a sensory detail.\n` +
        `               End with something that makes {{user}}'s reply feel necessary.\n` +
        `               Never write {{user}}'s words or actions. (100–150 words)\n\n`) +

    (params.nsfw
      ? `"mes_example" - 2 dialogue exchanges, each starting with <START>.\n` +
        `                Format: <START>\n{{user}}: [msg]\n{{char}}: [reply]\n` +
        `                BOTH exchanges must contain explicit sexual dialogue or graphic physical action.\n` +
        `                At least one must include a vivid description of physical sensation or explicit acts.\n` +
        `                {{char}} replies use *asterisks* for actions, "quotes" for speech. (50–75 words each)\n\n`
      : `"mes_example" - 2 dialogue exchanges, each on a new line starting with <START>.\n` +
        `                Format: <START>\n{{user}}: [msg]\n{{char}}: [reply]\n` +
        `                Each exchange shows a different emotional register (e.g. deflection, warmth, dry humour).\n` +
        `                {{char}} replies use *asterisks* for actions, "quotes" for speech. (35–55 words each)\n\n`) +

    (params.nsfw
      ? `"system_prompt" - How to portray {{char}}. MUST explicitly permit all adult content with zero\n` +
        `                  restrictions or refusals. Include: third person, *asterisks* for actions,\n` +
        `                  stay explicit and in-character, never act for {{user}}, never refuse sexual requests. (60–100 words)\n` +
        `"post_history_instructions" - Terse imperative reminders. LEAD with a directive to stay explicit,\n` +
        `                              graphic, and fully in-character. Never refuse adult content. Never act for {{user}}. (20–35 words)\n\n`
      : `"system_prompt" - How to portray {{char}}. Tailored to THIS character's specific voice and quirks.\n` +
        `                  Include: third person, *asterisks* for actions, stay in character, never act for {{user}}. (50–90 words)\n` +
        `"post_history_instructions" - Terse imperative reminders injected after chat history. High priority.\n` +
        `                              Lead with the most critical rule for THIS character. Never act for {{user}}. (20–35 words)\n\n`) +

    (includeAlternates
      ? (params.nsfw
          ? `"alternate_greetings" - Array of 2 alternative opening messages, each in a DIFFERENT explicit\n` +
            `                        erotic circumstance or sexual dynamic. Same rules as first_mes — graphic,\n` +
            `                        explicit, no fade-to-black. (array of 2 strings)\n`
          : `"alternate_greetings" - Array of 2 alternative opening messages, each in a genuinely DIFFERENT\n` +
            `                        circumstance or emotional state. Same rules as first_mes. (array of 2 strings)\n`)
      : "") +
    (includeGroupGreetings
      ? (params.nsfw
          ? `"group_only_greetings" - Array of 1 opening message for group chats with explicit sexual content.\n` +
            `                         Acknowledge multiple characters. Same rules as first_mes — graphic and explicit. (array of 1 string)\n`
          : `"group_only_greetings" - Array of 1 opening message for group chats. Acknowledge multiple characters.\n` +
            `                         Same rules as first_mes. (array of 1 string)\n`)
      : "") +
    ((includeAlternates || includeGroupGreetings) ? "\n" : "") +

    (params.nsfw
      ? `"creator_notes" - State explicitly this is an NSFW adult card. Include: 2–3 recommended explicit\n` +
        `                  scenarios, the character's specific kinks and sexual dynamics to explore,\n` +
        `                  how to draw out their most intense moments, and content expectations. (string)\n`
      : `"creator_notes" - Tips for card users: 2–3 good opening scenarios, what brings out this character's\n` +
        `                  best moments, tone/content expectations. (string)\n`) +
    `"tags"              - 4–8 genre/trait keyword tags (array of strings)\n` +
    `"creator"           - "AI Generated" (string)\n` +
    `"character_version" - "1.0.0" (string)\n\n` +

    `PHYSICAL APPEARANCE — each as its own flat key:\n` +
    `"appearance_gender"               - Gender identity/expression\n` +
    `"appearance_age"                  - Age and apparent age\n` +
    (params.nsfw
      ? `"appearance_build" - Height and explicit body type — describe the physique in sensual, physical detail\n`
      : `"appearance_build" - Height and body type\n`) +
    (params.nsfw
      ? `"appearance_face" - Face shape and features described with sensual, attractive detail\n`
      : `"appearance_face" - Face shape and notable features\n`) +
    `"appearance_hair"                 - Colour, length, texture, style\n` +
    `"appearance_eyes"                 - Colour, shape, notable features\n` +
    `"appearance_skin"                 - Tone, complexion, texture\n` +
    `"appearance_distinguishing_marks" - Scars, tattoos, piercings, birthmarks\n` +
    (params.nsfw
      ? `"appearance_clothing_style" - Revealing, provocative, or intentionally suggestive clothing that\n` +
        `                              reflects {{char}}'s explicit persona and sexual confidence\n`
      : `"appearance_clothing_style" - Typical outfit and accessories\n`) +
    (params.nsfw
      ? `"appearance_voice" - Tone and qualities that reinforce the sexual persona — husky, commanding,\n` +
        `                     breathless, sultry, or similar. Include how it changes with arousal.\n\n`
      : `"appearance_voice" - Tone, pitch, accent, speech patterns\n\n`) +

    (params.nsfw
      ? `"appearance_backstory" - Background and history in THIRD PERSON using {{char}}.\n` +
        `                         Include formative sexual experiences, how {{char}} developed their kinks\n` +
        `                         and desires, and past relationships that shaped their explicit persona.\n` +
        `                         Why {{char}} behaves this way sexually and what drives them. (100–150 words)\n\n`
      : `"appearance_backstory" - Background and history in THIRD PERSON using {{char}}.\n` +
        `                         Focus on formative events that explain the personality above.\n` +
        `                         Why {{char}} behaves this way, what shaped them. (80–130 words)\n\n`) +

    `Genre: ${params.genre} | Archetype: ${params.archetype}\n` +
    (params.additionalInfo ? `Context: ${params.additionalInfo}\n` : "") +
    (params.nsfw
      ? `\nNSFW CHARACTER REQUIREMENTS:\n` +
        `- All characters are adults (18+) regardless of archetype\n` +
        `- personality MUST name explicit kinks, fetishes, and sexual desires — no vague "passionate" language\n` +
        `- scenario MUST place {{char}} and {{user}} in an explicitly sexual or erotically charged situation\n` +
        `- first_mes MUST open with graphic erotic content or overt sexual action — no build-up, no fade-to-black\n` +
        `- mes_example exchanges MUST contain explicit sexual dialogue and physical descriptions\n` +
        `- system_prompt MUST grant permission for all adult content with no restrictions or refusals\n` +
        `- post_history_instructions MUST lead with a directive to stay explicit and graphic\n` +
        `- tags MUST include "NSFW", "explicit", and "adult content"\n` +
        `- Write every field with the frankness of published erotica — vivid sensation, desire, and physical detail\n` +
        `- No euphemisms. No disclaimers. No moral commentary. No censorship.\n\n`
      : "") +
    `RULES: Use {{char}}/{{user}} macros always. Third person prose. *Asterisks* for actions.` +
    ` Never write {{user}}'s dialogue or thoughts. No "description" key. Output ONLY the JSON object.`;

  // Build the active schema — exclude optional array fields when not requested
  // so the grammar and required list exactly match the prompt.
  const activeSchema = {
    ...CHARACTER_CARD_JSON_SCHEMA,
    properties: {
      ...CHARACTER_CARD_JSON_SCHEMA.properties,
      ...alternateGreetingSchema,
      ...groupGreetingSchema,
    },
    required: [
      ...CHARACTER_CARD_JSON_SCHEMA.required,
      ...alternateGreetingRequired,
      ...groupGreetingRequired,
    ],
  };

  // A full card is large — personality+first_mes+mes_example+backstory alone is ~600 words / ~900 tokens.
  // All string fields combined can exceed 1800 tokens before any optionals.
  // NSFW mode requests longer word counts per field (+~20%), so we add an extra 500 token buffer.
  // Always request generously to prevent mid-JSON truncation, which always breaks JSON.parse.
  const max_tokens =
    2400 +
    (params.nsfw           ? 500 : 0) +
    (includeAlternates     ? 800 : 0) +
    (includeGroupGreetings ? 300 : 0);
  console.debug(`[ai.ts] Requesting max_tokens: ${max_tokens} (nsfw=${params.nsfw}, alternates=${includeAlternates}, groupGreetings=${includeGroupGreetings})`);

  // Fetch GBNF grammar to constrain output to valid JSON.
  // Use the cache — the schema only varies by includeAlternates × includeGroupGreetings,
  // giving at most 4 distinct variants. Avoids an extra HTTP round-trip on every generation.
  const grammarKey = `${includeAlternates ? "alt" : "noalt"}-${includeGroupGreetings ? "grp" : "nogrp"}`;
  const grammar = await getCachedGrammar(activeSchema, grammarKey);
  if (grammar) {
    console.debug("[ai.ts] Grammar-constrained generation enabled.");
  }

  const response = await fetch(`${LOCAL_AI_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: params.signal,
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // NSFW mode uses slightly higher temperature — encourages more vivid, varied explicit prose
      // and discourages the model retreating to its "safe" default patterns.
      temperature: params.nsfw ? 0.92 : 0.8,
      max_tokens,
      // Mild repeat penalty — discourages padding fields with redundant sentences.
      rep_pen: 1.07,
      rep_pen_range: 256,
      // Stream tokens so the UI can show a live counter.
      stream: true,
      // If KoboldCpp provided a grammar, attach it — guarantees valid JSON output.
      ...(grammar ? { grammar } : {}),
    }),
  });

  if (!response.ok) {
    // Don't surface an error for user-initiated cancellations
    if (params.signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    const errorText = await response.text();
    console.error("[ai.ts] Server error:", errorText);
    throw new Error(`Local AI server error: ${response.status} ${response.statusText}`);
  }

  // ── Consume the SSE stream ────────────────────────────────────────────────
  // Tokens arrive as "data: {...}\n\n" frames. We assemble the full content
  // string here and call onProgress() on each chunk so the UI can display
  // a live token counter. JSON parsing happens once at EOS as before.
  let content = "";
  let finishReason = "unknown";
  let streamedTokens = 0;

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is not readable.");
  const decoder = new TextDecoder();
  let sseBuffer = "";

  streamLoop: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    // SSE frames are delimited by double-newline
    const frames = sseBuffer.split(/\n\n/);
    sseBuffer = frames.pop() ?? ""; // keep any partial frame

    for (const frame of frames) {
      const line = frame.replace(/^data:\s*/m, "").trim();
      if (line === "[DONE]") break streamLoop;
      if (!line) continue;

      let evt: Record<string, unknown>;
      try { evt = JSON.parse(line); } catch { continue; }

      const choices = evt.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      const token = delta?.content as string | undefined;
      if (token) {
        content += token;
        streamedTokens++;
        params.onProgress?.(streamedTokens);
      }

      const stopReason = choices?.[0]?.finish_reason as string | undefined;
      if (stopReason && stopReason !== "null") finishReason = stopReason;
    }
  }

  console.debug(`[ai.ts] finish_reason: ${finishReason} | streamed ~${streamedTokens} chunks`);

  if (!content) {
    console.error("[ai.ts] Empty response — no tokens received from stream.");
    throw new Error("Local AI returned an empty response.");
  }

  if (finishReason === "length") {
    console.warn("[ai.ts] Generation hit the token limit (finish_reason=length). Output may be truncated.");
  }

  console.debug("[ai.ts] Raw content:", content);

  // Strip markdown code fences (handles ```json, ```JSON, ``` with/without trailing text)
  let cleanJson = content
    .replace(/^```[\w]*\s*/i, "")
    .replace(/\s*```[\s\S]*$/i, "")
    .trim();

  // ── Pass 1: sanitise malformed characters inside JSON strings ──────────
  // Two problems this fixes:
  //   a. Bare control characters (newline, tab, etc.) inside string values —
  //      these are illegal in JSON and must become \n, \t, etc.
  //   b. Unescaped double-quote characters mid-value, e.g.
  //        "appearance_build": "5'8" (173cm), slender"
  //      The model wrote a literal " for the inch mark. We detect this by
  //      checking whether a closing-quote candidate is followed by a valid
  //      JSON structural token (,  :  }  ]  or end-of-string). If not, it
  //      must be an unescaped quote inside the value and we escape it.
  function sanitiseControlChars(s: string): string {
    let inString = false;
    let escaped  = false;
    let out      = "";
    for (let i = 0; i < s.length; i++) {
      const ch   = s[i];
      const code = s.charCodeAt(i);
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === "\\" && inString) { escaped = true; out += ch; continue; }
      if (ch === '"') {
        if (!inString) {
          // Opening a string
          inString = true;
          out += ch;
          continue;
        }
        // Potentially closing a string — look ahead to see what follows.
        // Skip any whitespace after the quote.
        let j = i + 1;
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\r' || s[j] === '\n')) j++;
        const next = s[j] ?? '';
        // Valid closing tokens: comma, colon, closing brace/bracket, or end
        if (next === ',' || next === ':' || next === '}' || next === ']' || next === '') {
          // Genuine string close
          inString = false;
          out += ch;
        } else {
          // Unescaped quote mid-value (e.g. inch mark) — escape it
          out += '\\"';
        }
        continue;
      }
      if (inString && code < 0x20) {
        if      (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else                  out += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    }
    return out;
  }

  // ── Pass 2: extract the first complete balanced JSON object ──────────────
  // Handles two failure modes:
  //   a. KoboldCpp prepends a performance stat header before the JSON:
  //      "CtxLimit:2502/24576, ... Output: {...}"
  //   b. The model repeats / appends duplicate fields after the closing }.
  // We stop at the brace that brings depth back to zero.
  function extractFirstJsonObject(s: string): string {
    const start = s.indexOf("{");
    if (start === -1) return s;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (escaped)               { escaped = false; continue; }
      if (ch === "\\" && inString) { escaped = true;  continue; }
      if (ch === '"')             { inString = !inString; continue; }
      if (inString)               { continue; }
      if (ch === "{")             { depth++; }
      else if (ch === "}")       { depth--; if (depth === 0) return s.slice(start, i + 1); }
    }
    return s.slice(start); // unclosed — repairTruncatedJson handles this next
  }

  // ── Pass 3: merge orphan string values into the preceding value ──────────
  // When a model splits a multi-exchange mes_example into separate JSON string
  // values it produces invalid JSON like:
  //   "mes_example": "<START>\n...", "<START>\n...", "next_key": ...
  // The second entry has no key. We detect strings-after-comma that are NOT
  // followed by a colon (i.e. not a key) and fold them into the prior value
  // with a \n separator.
  // Guard: only merge strings whose content contains \n or {{ — this prevents
  // accidentally merging legitimate array elements (e.g. tag strings).
  // Runs iteratively to handle multiple consecutive orphans.
  function mergeOrphanStrings(s: string): string {
    let prev: string;
    do {
      prev = s;
      s = s.replace(/",(\s*)("(?:[^"\\]|\\.)*")(\s*(?:,\s*"|}))/ ,
        (match, _ws, orphan: string, after: string) => {
          const inner = orphan.slice(1, -1); // strip surrounding quotes
          // Only merge if the content looks like dialogue/prose, not a short tag
          if (!inner.includes("\\n") && !inner.includes("{{")) return match;
          return "\\n" + inner + '"' + after.replace(/^,\s*/, ",");
        }
      );
    } while (s !== prev);
    return s;
  }

  // Extract the JSON object FIRST — before sanitising — so that sanitiseControlChars
  // only ever sees the actual { ... } block, not any preamble text the model may have
  // emitted before it (e.g. echoing the field descriptions back). Running sanitise on
  // preamble text caused the unescaped-quote lookahead to misfire on lines like:
  //   "name"       - Full name (string)
  // where the " - " following a closing quote is not a valid JSON structural token,
  // making the sanitiser escape the closing quote and corrupting the JSON.
  cleanJson = extractFirstJsonObject(cleanJson);
  cleanJson = sanitiseControlChars(cleanJson);
  cleanJson = mergeOrphanStrings(cleanJson);

  // ── Pass 4: strip trailing commas before } or ] ──────────────────────────
  // JSON.parse() rejects trailing commas (e.g. `"field": "value",}`) even
  // though they are valid in JavaScript. Models frequently emit them on the
  // last field of an object or the last element of an array.
  // This regex is safe because extractFirstJsonObject already removed any
  // content outside the outermost { }, so there is no risk of corrupting
  // surrounding text.
  cleanJson = cleanJson.replace(/,\s*([}\]])/g, "$1");

  // ── Pass 5: merge duplicate keys ─────────────────────────────────────
  // Some models emit the same key twice (e.g. two "mes_example" entries for
  // each dialogue exchange). JSON.parse silently discards all but the last.
  // We detect adjacent duplicate string-value fields and concatenate them
  // with \n so both exchanges are preserved.
  //
  // Only merges adjacent string-value pairs (not arrays/objects) where the
  // second value contains \n or {{ — same guard as mergeOrphanStrings.
  cleanJson = (function mergeDuplicateKeys(s: string): string {
    // Match: ..."key": "value1", "key": "value2"...
    // Capture: key (g1), value1 inner (g2), value2 inner (g3), trailing char (g4)
    const re = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)",\s*"\1"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let prev: string;
    do {
      prev = s;
      s = s.replace(re, (_m, key: string, v1: string, v2: string) => {
        // Only merge if at least one value looks like multi-line prose/dialogue
        if (!v1.includes("\\n") && !v1.includes("{{") &&
            !v2.includes("\\n") && !v2.includes("{{")) return _m;
        return `"${key}": "${v1}\\n${v2}"`;
      });
    } while (s !== prev);
    return s;
  })(cleanJson);

  // Attempt to repair truncated JSON — if the model hit the token limit mid-string,
  // the output ends abruptly. We close any unclosed string, then close open
  // objects/arrays in reverse nesting order so JSON.parse has a chance.
  function repairTruncatedJson(s: string): string {
    // Count unescaped quotes to determine if we're inside a string
    let inString = false;
    let escaped = false;
    const stack: string[] = []; // '{' or '[' for each open container

    for (const ch of s) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\" && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }

    let repaired = s;
    // Close any open string first
    if (inString) repaired += '"';
    // Then close containers in reverse order
    for (let i = stack.length - 1; i >= 0; i--) {
      repaired += stack[i] === "{" ? "}" : "]";
    }
    return repaired;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJson);
  } catch {
    // First parse failed — try repairing truncated output before giving up
    const repaired = repairTruncatedJson(cleanJson);
    console.warn("[ai.ts] Initial JSON.parse failed — attempting truncation repair.");
    console.debug("[ai.ts] Repaired JSON:", repaired);
    try {
      parsed = JSON.parse(repaired);
      console.info("[ai.ts] Truncation repair succeeded.");
    } catch {
      console.error("[ai.ts] JSON.parse failed even after repair. Raw content:", content);
      throw new Error(
        `The local AI did not return valid JSON.${
          finishReason === "length"
            ? " The output was cut off (token limit hit) — try reducing word count targets or using a server with higher max_length."
            : ""
        }\n\nRaw output preview:\n${content}`
      );
    }
  }

  const raw = coerceToCard(parsed);
  console.debug("[ai.ts] Coerced fields:", raw);

  // ── Extract appearance sub-fields from the flat AI response ─────────────
  const appearance: PhysicalAppearance = {
    ...DEFAULT_APPEARANCE,
    gender:               String((raw as Record<string, unknown>).appearance_gender               ?? ""),
    age:                  String((raw as Record<string, unknown>).appearance_age                  ?? ""),
    build:                String((raw as Record<string, unknown>).appearance_build                ?? ""),
    face:                 String((raw as Record<string, unknown>).appearance_face                 ?? ""),
    hair:                 String((raw as Record<string, unknown>).appearance_hair                 ?? ""),
    eyes:                 String((raw as Record<string, unknown>).appearance_eyes                 ?? ""),
    skin:                 String((raw as Record<string, unknown>).appearance_skin                 ?? ""),
    distinguishing_marks: String((raw as Record<string, unknown>).appearance_distinguishing_marks ?? ""),
    clothing_style:       String((raw as Record<string, unknown>).appearance_clothing_style       ?? ""),
    voice:                String((raw as Record<string, unknown>).appearance_voice                ?? ""),
    backstory:            String((raw as Record<string, unknown>).appearance_backstory            ?? ""),
  };

  // Strip the flat appearance_* keys so they don’t pollute the card
  const rawRecord = raw as Record<string, unknown>;
  for (const key of Object.keys(rawRecord)) {
    if (key.startsWith("appearance_")) delete rawRecord[key];
  }

  const fields: Partial<CharacterCard> = {
    ...raw,
    description: composeDescription(appearance),
    extensions:  { appearance },
  };

  // Normalise array fields — local models sometimes return comma-separated strings
  const coerceStringArray = (val: unknown): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String).filter(Boolean);
    return String(val).split(",").map((s) => s.trim()).filter(Boolean);
  };

  fields.tags                = coerceStringArray(fields.tags);
  fields.alternate_greetings = includeAlternates    ? coerceStringArray(fields.alternate_greetings) : [];
  fields.group_only_greetings = includeGroupGreetings ? coerceStringArray(fields.group_only_greetings) : [];

  // Ensure string fields are actually strings (guard against rogue model output)
  const stringFields = [
    "name", "nickname", "description", "personality", "scenario",
    "first_mes", "mes_example", "system_prompt", "post_history_instructions",
    "creator_notes", "creator", "character_version",
  ] as const;
  for (const key of stringFields) {
    if (fields[key] !== undefined && typeof fields[key] !== "string") {
      (fields as Record<string, unknown>)[key] = String(fields[key]);
    }
  }

  return fields;
}

/**
 * Generates an image prompt from the current character card.
 *
 * Z-Image Turbo (the bundled SD model) is a Flux-family model trained on
 * natural-language prose descriptions rather than tag lists — it responds
 * best to flowing, descriptive sentences. The prompt is kept concise
 * (≤ 512 tokens / ~350 words) so it fits comfortably in the model's context.
 */
export async function generateImagePrompt(
  card: Partial<CharacterCard>,
  nsfw?: boolean
): Promise<string> {
  const systemPrompt = nsfw
    ? "You are an expert at writing image generation prompts for Flux-based models. Write a single concise paragraph (50-80 words) describing a character portrait in vivid, specific prose. Focus on: physical appearance, clothing, expression, pose, and lighting. Be direct and visual. Include explicit adult details if the character calls for it. Output ONLY the description — no preamble, no labels, no markdown."
    : "You are an expert at writing image generation prompts for Flux-based models. Write a single concise paragraph (50-80 words) describing a character portrait in vivid, specific prose. Focus on: physical appearance, clothing, expression, pose, and lighting. Be direct and visual. Output ONLY the description — no preamble, no labels, no markdown.";

  // Pull appearance fields from extensions if available
  const app = (card.extensions?.appearance ?? {}) as Partial<PhysicalAppearance>;

  const appearanceParts = [
    app.gender && app.age ? `${app.gender}, ${app.age}` : (app.gender || app.age || ""),
    app.build            ?? "",
    app.face             ?? "",
    app.hair  ? `${app.hair} hair` : "",
    app.eyes  ? `${app.eyes} eyes` : "",
    app.skin  ? `${app.skin} skin` : "",
    app.distinguishing_marks ?? "",
    app.clothing_style ? `wearing ${app.clothing_style}` : "",
  ].filter(Boolean).join(", ");

  const personality = card.personality ? card.personality.slice(0, 150) : "";

  const nsfwLine = nsfw
    ? "\nThis is an adult character — include sensual or explicit visual details appropriate to their appearance."
    : "\nKeep the portrait tasteful and safe for work.";

  const userPrompt =
    `Write a portrait description for this character.\n` +
    (card.name       ? `Name: ${card.name}\n` : "") +
    (appearanceParts ? `Appearance: ${appearanceParts}\n` : "") +
    (personality     ? `Personality: ${personality}\n` : "") +
    nsfwLine +
    `\n\nWrite the description now (50-80 words, prose only, no lists):`;

  const response = await fetch(`${LOCAL_AI_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.75,
      max_tokens: 180,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[ai.ts] generateImagePrompt server error:", errorText);
    throw new Error(`Local AI server error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Local AI returned an empty response for image prompt.");
  }

  console.debug("[ai.ts] Raw image prompt:", content);

  // Strip any accidental markdown fences or surrounding quotes
  const cleanPrompt = content
    .replace(/^```[\w]*\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .replace(/^"+|"+$/g, "")
    .trim();

  return cleanPrompt;
}

/**
 * Base JSON schema for a single lorebook entry generation.
 */
const LOREBOOK_ENTRY_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keys:            { type: "array", items: { type: "string" } },
          content:         { type: "string" },
          comment:         { type: "string" },
          insertion_order: { type: "number" },
        },
        required: ["keys", "content", "comment", "insertion_order"],
      },
    },
  },
  required: ["entries"],
};

/**
 * Generates a batch of lorebook entries based on the character's existing data.
 */
export async function generateLorebook(params: {
  card: CharacterCard;
  entryCount: number;         // 3–10, default 5
  categories: string[];       // e.g. ["People", "Places", "Events", "Items", "Concepts"]
  nsfw?: boolean;
  signal?: AbortSignal;
}): Promise<Partial<CharacterBookEntry>[]> {
  const nsfwSystemAddendum = params.nsfw
    ? " You are writing explicit adult world-building lore for an 18+ roleplay. " +
      "Permit explicit relationship history, adult themes, and mature world details " +
      "consistent with the character's explicit persona. Do not censor or soften any content."
    : "";

  const systemPrompt =
    "You are an expert world-building assistant for AI roleplay. " +
    "Respond with a single valid JSON object only — no markdown fences, no commentary. " +
    "Start with { and end with }." +
    nsfwSystemAddendum;

  const personality = params.card.personality ? params.card.personality.slice(0, 300) : "";
  const scenario    = params.card.scenario    ? params.card.scenario.slice(0, 200)    : "";
  const backstory   = (params.card.extensions?.appearance as PhysicalAppearance)?.backstory ? ((params.card.extensions?.appearance as PhysicalAppearance)?.backstory || "").slice(0, 400) : "";
  const tags        = params.card.tags?.join(", ") || "";

  const userPrompt =
    `Summarise this character's world:\n` +
    `Name: ${params.card.name}\n` +
    (personality ? `Personality: ${personality}\n` : "") +
    (scenario    ? `Scenario: ${scenario}\n` : "") +
    (backstory   ? `Backstory: ${backstory}\n` : "") +
    (tags        ? `Tags: ${tags}\n` : "") +
    `\nGenerate EXACTLY ${params.entryCount} lorebook entries covering these categories: ${params.categories.join(", ")}.\n\n` +
    `Return a JSON object with a single "entries" array. Each entry object in the array MUST have:\n` +
    `"keys"            - Array of 2–4 short trigger keywords (lowercase strings)\n` +
    `"content"         - 100–200 words of lore. Third person prose. Use {{char}} for the character's name.\n` +
    `"comment"         - Short display label (e.g. "The Blacksmith", "City of Oakhaven")\n` +
    `"insertion_order" - An integer (use a number starting from 10, incrementing by 10 for each entry)\n\n` +
    `Do NOT write anything outside the JSON object.`;

  const max_tokens = Math.min(4096, params.entryCount * 350 + (params.nsfw ? 200 : 0));
  console.debug(`[ai.ts] generateLorebook requesting max_tokens: ${max_tokens} for ${params.entryCount} entries`);

  const grammar = await getGrammarFromSchema(LOREBOOK_ENTRY_SCHEMA);

  const response = await fetch(`${LOCAL_AI_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: params.signal,
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: params.nsfw ? 0.92 : 0.8,
      max_tokens,
      ...(grammar ? { grammar } : {}),
    }),
  });

  if (!response.ok) {
    if (params.signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    const errorText = await response.text();
    throw new Error(`Local AI server error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Local AI returned an empty response.");
  }

  // Run the 5-pass JSON sanitisation pipeline
  let cleanJson = content
    .replace(/^```[\w]*\s*/i, "")
    .replace(/\s*```[\s\S]*$/i, "")
    .trim();

  const startIdx = cleanJson.indexOf("{");
  const arrStartIdx = cleanJson.indexOf("[");
  // Handles models that just return an array directly instead of wrapping in { entries: [...] }
  if (arrStartIdx !== -1 && (startIdx === -1 || arrStartIdx < startIdx)) {
     cleanJson = `{"entries": ${cleanJson.slice(arrStartIdx)}}`;
  } else if (startIdx !== -1) {
     // Pass 2 logic (inlined for simplicity on the already-clean string)
     let depth = 0, inString = false, escaped = false;
     for (let i = startIdx; i < cleanJson.length; i++) {
       const ch = cleanJson[i];
       if (escaped)               { escaped = false; continue; }
       if (ch === "\\" && inString) { escaped = true;  continue; }
       if (ch === '"')             { inString = !inString; continue; }
       if (inString)               { continue; }
       if (ch === "{")             { depth++; }
       else if (ch === "}")       { depth--; if (depth === 0) { cleanJson = cleanJson.slice(startIdx, i + 1); break; } }
     }
  }

  // Strip trailing commas before closing braces/brackets
  cleanJson = cleanJson.replace(/,\s*([}\]])/g, "$1");

  let parsed;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error("[ai.ts] Lorebook JSON.parse failed. Raw:", content);
    throw new Error("The local AI did not return valid JSON for the lorebook.\n\nRaw output preview:\n" + content.slice(0, 500) + "...");
  }

  // Coerce array if the model ignored the { entries: [] } wrapper
  const entriesArray = Array.isArray(parsed) ? parsed : (parsed.entries || []);
  
  if (!Array.isArray(entriesArray)) {
    throw new Error("AI did not return a valid entries array.");
  }

  return entriesArray.map((e: any) => ({
    keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
    content: String(e.content || ""),
    comment: String(e.comment || ""),
    insertion_order: Number(e.insertion_order) || 50,
  }));
}

// ---------------------------------------------------------------------------
// Per-Field Regeneration
// ---------------------------------------------------------------------------

/** Fields that support per-field regeneration. */
export type RegenerableField =
  | "personality"
  | "scenario"
  | "first_mes"
  | "mes_example"
  | "system_prompt"
  | "post_history_instructions"
  | "creator_notes"
  | `appearance_${keyof PhysicalAppearance}`;

const FIELD_LABELS: Record<RegenerableField, string> = {
  personality: "Personality",
  scenario: "Scenario",
  first_mes: "First Message",
  mes_example: "Example Dialogue",
  system_prompt: "System Prompt",
  post_history_instructions: "Post-History Instructions",
  creator_notes: "Creator Notes",
  appearance_gender: "Gender",
  appearance_age: "Age",
  appearance_build: "Build",
  appearance_face: "Face",
  appearance_hair: "Hair",
  appearance_eyes: "Eyes",
  appearance_skin: "Skin",
  appearance_distinguishing_marks: "Distinguishing Marks",
  appearance_clothing_style: "Clothing Style",
  appearance_voice: "Voice",
  appearance_backstory: "Backstory",
};

/**
 * Regenerates a single card field using the rest of the card as context.
 * Returns the new plain-string value — no JSON, no markdown.
 */
export async function regenerateField(
  field: RegenerableField,
  card: CharacterCard,
  nsfw = false,
  signal?: AbortSignal,
): Promise<string> {
  const fieldLabel = FIELD_LABELS[field];
  const isAppearance = field.startsWith("appearance_");
  const isFirstMes = field === "first_mes";
  const isMesExample = field === "mes_example";

  // Build brief card context
  const app = (card.extensions?.appearance ?? {}) as Partial<PhysicalAppearance>;
  const appearanceSummary = [
    app.gender ? `Gender: ${app.gender}` : "",
    app.age    ? `Age: ${app.age}` : "",
    app.build  ? `Build: ${app.build}` : "",
    app.hair   ? `Hair: ${app.hair}` : "",
  ].filter(Boolean).join("; ");

  const cardContext = [
    card.name        ? `Name: ${card.name}` : "",
    card.tags?.length ? `Tags: ${card.tags.slice(0, 8).join(", ")}` : "",
    card.personality  ? `Personality (excerpt): ${card.personality.slice(0, 200)}` : "",
    card.scenario     ? `Scenario (excerpt): ${card.scenario.slice(0, 200)}` : "",
    appearanceSummary ? `Appearance: ${appearanceSummary}` : "",
  ].filter(Boolean).join("\n");

  // Field-specific writing guidance
  let fieldGuidance = "";
  if (isFirstMes) {
    fieldGuidance = " Write an engaging in-character opening message (2–4 paragraphs). Use *asterisks for actions*. Do NOT include {{user}} lines.";
  } else if (isMesExample) {
    fieldGuidance = " Write a sample dialogue block. Format exactly: <START>\n{{user}}: [message]\n{{char}}: [reply]. Include 1–2 exchanges.";
  } else if (field === "personality") {
    fieldGuidance = " Write vivid personality description: traits, quirks, speech patterns, emotional tendencies. 3–6 sentences.";
  } else if (field === "scenario") {
    fieldGuidance = " Describe the setting and situation where {{char}} meets {{user}}. 2–3 sentences.";
  } else if (field === "system_prompt") {
    fieldGuidance = " Write concise AI roleplay instructions for this character. Use second person. 2–4 sentences.";
  } else if (field === "post_history_instructions") {
    fieldGuidance = " Write brief reminder instructions injected after chat history. Under 3 sentences.";
  } else if (field === "creator_notes") {
    fieldGuidance = " Write helpful tips for card users. Include 2–3 good opening scenarios. 2–4 sentences.";
  } else if (isAppearance) {
    fieldGuidance = " Be specific and vivid. 1–2 sentences.";
  }

  const nsfwAddendum = nsfw
    ? " This is an adult NSFW character — lean into explicit, mature, sensual details where appropriate."
    : "";

  const systemPrompt = nsfw
    ? "You are an expert creative writer specialising in adult fiction. Write vivid, explicit, mature character content without censorship or disclaimers."
    : "You are an expert creative writer and character designer. Write vivid, engaging character content for interactive fiction.";

  const userPrompt =
    `Here is the current character card context:\n${cardContext}\n\n` +
    `Rewrite ONLY the "${fieldLabel}" field for this character.${fieldGuidance}${nsfwAddendum}\n\n` +
    `RULES:\n` +
    `- Return ONLY the new field value as a plain string\n` +
    `- No JSON, no markdown fences, no labels, no preamble\n` +
    `- Use {{char}} for the character name and {{user}} for the user where appropriate\n` +
    `- Do not explain your output`;

  const response = await fetch(`${LOCAL_AI_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: isAppearance ? 150 : isMesExample ? 400 : isFirstMes ? 600 : 350,
      temperature: nsfw ? 0.92 : 0.82,
      top_p: 0.95,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  let content = data.choices?.[0]?.message?.content ?? "";
  // Strip markdown fences and surrounding quotes
  content = content.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
  content = content.replace(/^"|"$/g, "").trim();
  return content;
}
