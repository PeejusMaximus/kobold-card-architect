# Kobold Card Architect — Project Guide

> **Last updated:** Reflects the current codebase including the 5-pass AI output sanitisation pipeline, SSE streaming, grammar cache, `useCardHistory` undo/redo hook, `LorebookView` component, AI lorebook generation, per-field regeneration (`regenerateField`), the live token budget bar, `RegenButton`, `QuickPick` genre/archetype chips, `rawCopied` debug clipboard state, the full NSFW pipeline, portrait generation defaults, Character Library (IndexedDB), `LibraryDrawer`, prompt quality improvements (appearance-first ordering, hardcoded creator/version, per-field guidance, stop sequences), extended `KoboldServerStatus` (capability flags, `maxOutputLength`, `getMaxOutputLength`), and the full `.continue/rules/` reference.

---
## 1. Project Overview

**Kobold Card Architect** is a web-based AI-assisted character card generator and editor designed for the AI roleplay community. It allows users to build, edit, import, and export character cards in JSON format compatible with **KoboldLite** and **SillyTavern**.

Character generation is powered entirely by a **local AI model** via an OpenAI-compatible API endpoint — no cloud services, no API keys, complete privacy.

### Key Technologies

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build Tool | Vite 6 |
| Styling | Tailwind CSS v4 + shadcn/ui (Base UI primitives) |
| AI Integration | Native `fetch` → OpenAI-compatible local endpoint, SSE streaming |
| Storage | IndexedDB (character library) + `localStorage` (theme, NSFW mode) |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |

### High-Level Architecture

Single Page Application (SPA). State is managed entirely via React `useState` hooks inside `CharacterEditor` (with card state delegated to the `useCardHistory` hook) — there is no external state library. AI generation is done client-side by sending `POST /v1/chat/completions` to the local inference server, consumed as **SSE** so the UI can display a live token counter.

Library state (`libraryOpen`, `loadedCard`, `cardDirty`) is lifted to `App.tsx` so the `LibraryDrawer` and `CharacterEditor` can communicate without prop drilling. When a card is loaded from the library, `CharacterEditor` remounts via a `key` prop to reinitialise all state cleanly.

KoboldCpp-specific features (status polling, token counting, GBNF grammar, portrait generation) are accessed via `src/lib/kobold.ts`. These degrade gracefully on non-KoboldCpp servers — every function returns `null` / `0` / `{ online: false }` on error and never throws.

---
## 2. Getting Started

### Prerequisites

- **Node.js** v18+
- A running local AI server:

| Server | Default URL | Full Feature Support |
|---|---|---|
| KoboldCpp | `http://127.0.0.1:5001/v1` | ✅ Recommended — all features |
| LM Studio | `http://127.0.0.1:1234/v1` | ⚠ Generation only |
| Ollama | `http://127.0.0.1:11434/v1` | ⚠ Generation only |

### Installation

```bash
cd kobold-card-architect
npm install
npm run dev
```

App runs at `http://localhost:3000` (bound to `0.0.0.0` so it's accessible on LAN).

### Environment Configuration (Optional)

```env
# kobold-card-architect/.env.local
VITE_LOCAL_AI_URL=http://127.0.0.1:5001/v1
DISABLE_HMR=false
```

### Build Scripts

```bash
npm run dev      # start dev server at http://localhost:3000 (binds 0.0.0.0)
npm run build    # production build → dist/
npm run preview  # preview the production build
npm run lint     # TypeScript type-check (tsc --noEmit) — no ESLint config
npm run clean    # delete dist/
```

---
## 3. Project Structure

```
kobold-card-architect/
├── src/
│   ├── components/
│   │   ├── CharacterEditor.tsx   # Main editor — ALL form logic, state, and AI calls
│   │   ├── LibraryDrawer.tsx     # Slide-in character library panel (IndexedDB)
│   │   ├── LorebookView.tsx      # Full-page lorebook editor (separate view)
│   │   └── ThemeToggle.tsx       # Light/dark mode toggle
│   ├── hooks/
│   │   └── useCardHistory.ts     # Ring-buffer undo/redo hook (30 snapshots)
│   ├── lib/
│   │   ├── ai.ts                 # Local AI client — char gen, image prompt, lorebook, field regen
│   │   ├── kobold.ts             # KoboldCpp native API — status, tokens, portrait, grammar
│   │   ├── cardio.ts             # Import / export helpers (JSON + PNG)
│   │   ├── library.ts            # IndexedDB character library wrapper
│   │   └── png.ts                # Pure-browser PNG chunk reader/writer (zero deps)
│   ├── types.ts                  # CharacterCard, CharacterBook, PhysicalAppearance + defaults
│   ├── App.tsx                   # Root layout — header, Library state, CharacterEditor
│   ├── index.css                 # Global styles + Tailwind CSS v4
│   └── main.tsx                  # React entry point
│
├── components/
│   └── ui/                       # shadcn/ui primitives (owned source — edit freely)
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── scroll-area.tsx
│       ├── select.tsx
│       ├── switch.tsx
│       ├── tabs.tsx
│       └── textarea.tsx
│
├── docs/
│   ├── koboldcpp-api-reference.md
│   ├── koboldcpp-cli-flags.md
│   └── koboldcpp-sampler-guide.md
│
├── lib/
│   └── utils.ts                  # cn() utility (clsx + tailwind-merge)
│
├── start-kobold.sh               # Interactive KoboldCpp launcher script
├── vite.config.ts                # Vite config (plugins, aliases, chunk splitting)
├── tsconfig.json
└── package.json
```

### Key Path Alias

`@` maps to the **project root** (`kobold-card-architect/`):

```ts
import { Button }            from "@/components/ui/button";
import { CharacterCard }     from "@/src/types";
import { generateCharacter } from "@/src/lib/ai";
import { saveCard }          from "@/src/lib/library";
import { cn }                from "@/lib/utils";
```

Never use relative paths like `../../`. Always use `@/`.

---
## 4. Development Standards

- **Strict TypeScript** — run `npm run lint` before committing. Prefix unused vars with `_`.
- **Import paths** — always `@/components/...` for shadcn/ui, `@/src/...` for app logic. No relative imports.
- **Styling** — Tailwind utility classes only. Use `cn()` for conditional class merging. No raw CSS or inline `style` props (exception: dynamic `width: X%` on progress bars).
- **UI components** — always use shadcn primitives. Do not create duplicate wrappers or raw HTML form elements where a shadcn component exists.
- **Card mutations** — all `setCard` calls must go through `set` from `useCardHistory`, not a raw `useState` setter, so every change is undoable.
- **KoboldCpp API** — all KoboldCpp-specific calls live in `kobold.ts`. Functions must never throw — always return a safe default on error.
- **AI prompts** — prompts live in `ai.ts`. Always run the full 5-pass sanitisation pipeline before `JSON.parse()`.

---
## 5. Key Concepts

### CharacterCard Schema (`src/types.ts`)

Full CCv3 superset — all V1, V2, and V3 fields:

| Field | Spec | Purpose |
|---|---|---|
| `name` | V1 | Character's display name |
| `description` | V1 | Auto-composed from `PhysicalAppearance` — do not edit directly |
| `personality` | V1 | Traits and behavioural tendencies |
| `scenario` | V1 | Current situation / setting |
| `first_mes` | V1 | Opening message sent by the character |
| `mes_example` | V1 | Sample `<START>` dialogue block |
| `creator_notes` | V2 | Notes for card consumers |
| `system_prompt` | V2 | Overrides the AI's default system instructions |
| `post_history_instructions` | V2 | Instructions injected after chat history |
| `alternate_greetings` | V2 | Array of alternative first messages |
| `tags` | V2 | Genre/trait labels |
| `creator` | V2 | Author attribution — hardcoded `"AI Generated"` post-generation |
| `character_version` | V2 | Semver — hardcoded `"1.0.0"` post-generation |
| `extensions` | V2 | App-specific data. Stores `appearance` object. |
| `character_book` | V2 | Embedded lorebook |
| `nickname` | V3 | Replaces `{{char}}` in prompts |
| `creator_notes_multilingual` | V3 | Per-language creator notes (ISO 639-1 keys) |
| `source` | V3 | Append-only source URLs — read-only in UI |
| `group_only_greetings` | V3 | First messages used only in group chats |
| `creation_date` | V3 | Unix timestamp (seconds) — set once on first export |
| `modification_date` | V3 | Unix timestamp (seconds) — updated on every export |
| `avatar` | Internal | Base64 data URL — never exported to JSON |

### PhysicalAppearance (`src/types.ts`)

Stored in `extensions.appearance`. `composeDescription(appearance)` composes it into the `description` field automatically on every change. Sub-fields: `gender`, `age`, `build`, `face`, `hair`, `eyes`, `skin`, `distinguishing_marks`, `clothing_style`, `voice`, `backstory`.

`composeDescription()` output order: `Gender` → `Age | Build` (combined) → `Face` → `Hair` → `Eyes` → `Skin` → `Distinguishing marks` → `Clothing & style` → `Voice` → backstory (preceded by a blank line).

### Undo / Redo Hook (`src/hooks/useCardHistory.ts`)

```ts
const { card, set, undo, redo, canUndo, canRedo } = useCardHistory(DEFAULT_CHARACTER);
```

- 30-snapshot ring buffer. `set()` accepts direct value or functional updater.
- `Ctrl+Z` → undo, `Ctrl+Y` / `Ctrl+Shift+Z` → redo (suppressed when focus is in a text field).
- Toolbar shows `Undo2` / `Redo2` icon buttons in the Character Identity card header.
- **All card mutations must go through `set`** — raw `useState` setters bypass history.

### App.tsx — Library State

Library state is lifted here so `LibraryDrawer` and `CharacterEditor` can share it cleanly:

```ts
const [libraryOpen, setLibraryOpen]   // controls LibraryDrawer open/close
const [loadedCard, setLoadedCard]     // { card, nsfwMode, key } — set when loading from library
const [cardDirty, setCardDirty]       // true when card.name is set — drives overwrite warning
```

When `loadedCard` changes, `CharacterEditor` remounts via `key={loadedCard?.key}` and initialises with `initialCard` and `initialNsfwMode` props. This is the cleanest way to fully reset all editor state without drilling reset callbacks.

### CharacterEditor Props

```ts
interface CharacterEditorProps {
  initialCard?:     CharacterCard;  // seeds useCardHistory instead of DEFAULT_CHARACTER
  initialNsfwMode?: boolean;        // overrides localStorage on initial render
  onDirtyChange?:   (dirty: boolean) => void;  // fires when card.name changes
}
```

### CharacterEditor State

| State | Type | Purpose |
|---|---|---|
| `card` / `set` / `undo` / `redo` | `useCardHistory` | Full card state with undo/redo |
| `isGenerating` | `boolean` | Full character AI generation in progress |
| `streamTokenCount` | `number` | Live token count from SSE stream |
| `reGeneratingField` | `string \| null` | Active per-field regen key (e.g. `"first_mes[0]"`) |
| `genError` | `string \| null` | Error shown in AI Architect card |
| `genRawOutput` | `string \| null` | Raw AI output for clipboard debugging |
| `rawCopied` | `boolean` | 2-second "Copied!" flash for raw output copy button |
| `nsfwMode` | `boolean` | Persisted to `localStorage` `kca-nsfw` |
| `isSavingToLibrary` | `boolean` | Save-to-library in progress |
| `savedToLibrary` | `boolean` | 2-second "Saved!" confirmation flag |
| `includeAlternates` | `boolean` | Request `alternate_greetings` from AI |
| `includeGroupGreetings` | `boolean` | Request `group_only_greetings` from AI |
| `isExporting` | `boolean` | PNG export in progress |
| `serverStatus` | `KoboldServerStatus` | Polled every 10s |
| `tokenCounts` | `Record<string, number>` | Per-field token counts |
| `view` | `'character' \| 'lorebook'` | Switches between editor and LorebookView |
| `imagePrompt` | `string` | SD prompt textarea value |
| `isGeneratingPrompt` | `boolean` | `generateImagePrompt()` in progress |
| `isGeneratingPortrait` | `boolean` | `generatePortrait()` in progress |
| `promptCopied` | `boolean` | 2-second "Copied!" flash for image prompt copy button |
| `genParams` | `{ genre, archetype, additionalInfo }` | AI generation form parameters |

Key refs:
- `abortControllerRef` — active `AbortController` for full card generation.
- `fieldRegenRefsMap` — `Map<string, AbortController>` for per-field abort.
- `tokenDebounceRef` — 600ms debounce timers per field for token counting.
- `jsonImportRef` / `pngImportRef` / `avatarInputRef` — hidden file inputs.

Internal UI components (top of `CharacterEditor.tsx`, not exported):
- **`FormatButton`** — dashed-border icon tile for Import/Export dialogs.
- **`TokenBadge`** — token count pill. Hidden when `count === 0`. Colour: muted < 300, amber 300–600, rose > 600.
- **`RegenButton`** — `Wand2` icon. Disabled during full generation or when another field is regenerating. Spins while active.
- **`QuickPick`** — chip row + text `<Input>` for Genre / Archetype selection. Chips for 8 genres and 10 archetypes. Selected chip highlighted with primary colour.

`MIN_RECOMMENDED_TOKENS = 1500` — constant used to warn in the UI when `serverStatus.maxOutputLength` is too low for a full card generation.

### Character Library (`src/lib/library.ts` + `src/components/LibraryDrawer.tsx`)

**`library.ts`** — thin IndexedDB wrapper. DB: `kca-library`, store: `characters`, key: auto-increment `id`.

```ts
interface LibraryRecord {
  id?:       number;
  name:      string;
  tags:      string[];
  nsfwMode:  boolean;
  savedAt:   number;        // Unix ms
  card:      CharacterCard;
}

saveCard(card, nsfwMode): Promise<number>   // returns new id
loadAllCards(): Promise<LibraryRecord[]>     // newest first
deleteCard(id): Promise<void>
updateCard(id, card, nsfwMode): Promise<void>
```

**`LibraryDrawer.tsx`** — slide-in panel from the left. Spring-animated (`damping: 28, stiffness: 300`) via `motion/react`.

- Triggered by the **Library** button in `App.tsx` header.
- 2-column portrait grid (`aspect-[3/4]` tiles) with hover overlay (Load + Delete buttons).
- Tags shown below each tile (up to 3 visible, `+N` overflow).
- Search bar filters by name or tag in real time.
- Confirm dialog before overwriting a dirty card. Confirm dialog before deleting.
- **NSFW detection** — `isNsfw(record)` checks both `record.nsfwMode` and whether `record.tags` contains `"nsfw"`, `"explicit"`, or `"adult content"` (case-insensitive). Rose border + NSFW badge on matching tiles.
- Loading skeletons (4 `aspect-[3/4]` pulsing tiles), error state with `AlertTriangle`, empty state with hint.
- Footer shows card count when results are present.

**Save flow** — **Save** button in the Character Identity toolbar (requires `card.name`). Shows "Saved!" flash for 2 seconds. Uses `saveCard()` — always creates a new record (no overwrite/update).

**Load flow** — `commitLoad(record)` calls `onLoadCard(card, nsfwMode)` → `App.tsx` sets `loadedCard` → `CharacterEditor` remounts with the new card and NSFW mode.

### Local AI Client (`src/lib/ai.ts`)

#### `generateCharacter(params)`

**System prompt design:**
- Opens with domain context: *"You are a SillyTavern character card author. Your output will be loaded directly into an AI roleplay frontend."*
- Explicit JSON constraint: *"The very first character of your response must be `{` and the last must be `}`"*
- `{{char}}/{{user}}` macro rule declared here (global scope, not buried in user prompt)
- NSFW addendum separated by `\n\n`

**User prompt design:**
- **Appearance fields come FIRST** — prose fields (personality, scenario, first_mes) are written after the model has a fully realised physical character to anchor to
- `creator` and `character_version` are **NOT requested from the model** — hardcoded post-generation as `"AI Generated"` / `"1.0.0"`
- `mes_example` uses a concrete example block format (not a `\n`-in-string template)
- Each appearance field has a specific example hint (e.g. `"e.g. 5'9\", lean and wiry"`)
- NSFW/SFW variants for most fields — different word count targets, framing, and explicit content requirements
- Structured with labelled sections: `── IDENTITY ──`, `── PHYSICAL APPEARANCE ──`, `── PERSONALITY & STORY ──`, `── DIALOGUE ──`, `── INSTRUCTIONS ──`, `── META ──`

**Sanitisation pipeline** (runs in this exact order before `JSON.parse()`):

| Pass | Operation | What it fixes |
|---|---|---|
| 1 | `extractFirstJsonObject()` | Strips preamble / content outside `{...}` — **must run first** |
| 2 | `sanitiseControlChars()` | Escapes bare control chars and unescaped `"` inside string values |
| 3 | `mergeOrphanStrings()` | Folds keyless string values (split `mes_example`) into preceding value |
| 4 | Trailing comma regex | Removes `,}` and `,]` |
| 5 | `mergeDuplicateKeys()` | Concatenates adjacent duplicate key pairs with `\n` |

If `JSON.parse()` fails, `repairTruncatedJson()` closes unclosed strings/containers for a second attempt. Malformed shapes handled by `coerceToCard()` + `flattenObject()`.

**Parameters:** `max_tokens`: `2400 + 500 (NSFW) + 800 (alternates) + 300 (group greetings)`. `temperature`: `0.92` NSFW / `0.80` SFW. `rep_pen: 1.07`, `rep_pen_range: 256`. Streaming.

**Grammar cache** — `grammarCache: Map<string, string | null>`. 4 variants (`alt/noalt` × `grp/nogrp`). Avoids round-trip to `/api/extra/json_to_grammar` after first generation.

#### `generateImagePrompt(card, nsfw?)`

- System prompt contains **no word count** — word count lives in user prompt only (no duplication).
- Appearance parts ordered **gender/age → face → hair → eyes → skin → marks → build → clothing** (Flux weights earlier tokens more heavily; face features matter most for portrait composition).
- Uses **scenario excerpt** (150 chars) not personality — setting/pose context is more useful for image gen.
- Falls back to `"Portrait style: upper body, direct gaze, natural lighting"` when no scenario is set.
- `max_tokens: 180`, `temperature: 0.75`, non-streaming.

#### `generateLorebook(params)`

- System prompt explains what lorebook entries are and how they're injected into roleplay context.
- Content length: **120–160 words** per entry.
- `comment` field: *"2–5 word label only, like a chapter heading"*.
- `insertion_order`: sequential integers starting at 1.
- Category distribution: *"Distribute entries roughly evenly across the requested categories"*.
- `max_tokens`: `min(4096, entryCount × 380 + 200 if NSFW)`.
- Non-streaming (JSON response). Handles both `{ entries: [...] }` and bare array responses.

#### `regenerateField(field, card, nsfw?, signal?)`

- Typed as `RegenerableField` — union of 7 prose fields + `appearance_${keyof PhysicalAppearance}`.
- **Includes current field value** in context as *"Current value (improve this):"* — model refines rather than replaces.
- Full appearance summary (8 fields) included for consistency across appearance regens.
- **`APPEARANCE_GUIDANCE` map** — per-field ordering/structure hints for all 11 appearance fields (e.g. hair: colour → length → texture → style).
- `system_prompt` guidance: *"Write in second person addressed to the AI: 'You are {{char}}...'"* for `system_prompt` field.
- **Stop sequences:** `["\n\nNote:", "\n\nI ", "\n\n---", "\n\nThis "]` — prevents self-critique bleed.
- `max_tokens`: `150` (appearance) / `400` (mes_example) / `600` (first_mes) / `350` (other). `temperature: 0.92` NSFW / `0.82` SFW. `top_p: 0.95`. Non-streaming.
- Per-field abort via `fieldRegenRefsMap` (`Map<string, AbortController>`).

### LorebookView (`src/components/LorebookView.tsx`)

Props: `{ card, setCard, nsfwMode, onBack }`. Renders when `view === 'lorebook'`.

- `setCard` prop type is `React.Dispatch<React.SetStateAction<CharacterCard>>` (the raw dispatcher from `useCardHistory`'s `set`).
- Categories: `["People", "Places", "Events", "Items", "Concepts"]`.
- Entry count selector: buttons for 3–10.
- Generate/Stop buttons with `lorebookAbortRef` for cancellation.
- Entry accordion: enabled switch, display name field, insertion order, trigger keywords (comma-separated), content textarea, position select, constant/selective switches, secondary keys (shown only when selective is on).
- Auto-expands newly generated entries via `expandedEntries` Set.
- Skeleton placeholders during generation (pulsing tiles matching `lorebookEntryCount`).
- Export Worldinfo button (disabled when no entries).

### KoboldCpp Native API (`src/lib/kobold.ts`)

| Export | Purpose |
|---|---|
| `getServerStatus()` | `KoboldServerStatus` — online, version, model, context, speed, busy, queue, tokens, capabilities, maxOutputLength |
| `getMaxOutputLength()` | Standalone fetch of `/api/v1/config/max_length`. Returns `number \| null`. |
| `countTokens(text)` | Exact token count via `/api/extra/tokencount`. Returns `0` on error. |
| `abortGeneration()` | `POST /api/extra/abort`. Silent on error. |
| `generatePortrait(params)` | A1111-compatible SD gen via `/sdapi/v1/txt2img`. Returns `data:image/png;base64,...`. |
| `getGrammarFromSchema(schema)` | GBNF grammar string or `null`. |

**`KoboldServerStatus` fields:**

| Field | Source | Notes |
|---|---|---|
| `online` | `/api/extra/version` | `false` on any error |
| `version` | `/api/extra/version` | KoboldCpp version string (date-based) |
| `model` | `/api/v1/model` | Vendor prefix `"koboldcpp/"` stripped |
| `maxContextLength` | `/api/extra/true_max_context_length` | Real launcher value |
| `evalSpeed` | `/api/extra/perf` → `last_eval_speed` | Rounded t/s |
| `busy` | `/api/extra/perf` → `idle === 0 \|\| queue > 0` | |
| `queue` | `/api/extra/perf` → `queue` | |
| `lastInputTokens` | `/api/extra/perf` → `last_input_count` | |
| `lastOutputTokens` | `/api/extra/perf` → `last_token_count` | |
| `lastStopReason` | `/api/extra/perf` → `stop_reason` | -1=INVALID, 0=OUT_OF_TOKENS, 1=EOS, 2=CUSTOM |
| `hasVision` | `/api/extra/version` → `vision` | |
| `hasTxt2Img` | `/api/extra/version` → `txt2img` | Enables portrait generation button |
| `hasTranscribe` | `/api/extra/version` → `transcribe` | |
| `hasTts` | `/api/extra/version` → `tts` | |
| `hasEmbeddings` | `/api/extra/version` → `embeddings` | |
| `hasWebSearch` | `/api/extra/version` → `websearch` | |
| `hasMultiplayer` | `/api/extra/version` → `multiplayer` | |
| `maxOutputLength` | `/api/v1/config/max_length` | If < `MIN_RECOMMENDED_TOKENS` (1500), UI warns |

**Portrait defaults** (`generatePortrait`): `steps: 9`, `cfg_scale: 0.0`, `width: 512`, `height: 768`, `sampler_name: "Euler"`, `seed: -1`. 2-minute timeout via internal `AbortController`. Handles base64 with/without data URI prefix. Strips embedded whitespace from some KoboldCpp builds.

**Token Budget Bar** (AI Architect `CardFooter`): sums all `tokenCounts` vs. `serverStatus.maxContextLength`. Colour: emerald < 50%, amber 50–80%, rose > 80%.

### Import / Export (`src/lib/cardio.ts` + `src/lib/png.ts`)

- `importCardFromJson(file)` — CCv3 / V2 / flat. Merges with `DEFAULT_CHARACTER`. Normalises appearance: if no `extensions.appearance` exists, seeds `backstory` from legacy `description`.
- `importCardFromPng(file)` — reads `ccv3` chunk (preferred) or `chara`. Returns `{ card, avatarDataUrl }`.
- `exportCardAsJson(card)` — CCv3 envelope. Stamps timestamps.
- `exportCardAsPng(card)` — embeds `ccv3` + `chara` chunks. Uses avatar or generates a styled placeholder canvas (400×600, indigo gradient, initial letter, name, creator, tags strip, version badge).
- `exportLorebookAsJson(book, cardName?)` — KoboldLite `{ worldinfo: [...] }` format. Maps CCv3 fields to KL fields (`keys → key`, `secondary_keys → keysecondary`, `position === "after_char" → wep: true`).

### NSFW Mode

Toggled via the **NSFW Mode** button in the AI Architect card (uses `FlameKindling` icon). Persisted to `localStorage` `kca-nsfw`. Flows to all four AI functions. In `generateCharacter()`: rewrites system prompt, per-field explicit instructions, `temperature: 0.92`, `+500 max_tokens`, auto-tags (`"NSFW"`, `"explicit"`, `"adult content"`).

---
## 6. Common Tasks

### Save / load a card from the library

- **Save** — click **Save** in the Character Identity toolbar (requires `card.name`). Always creates a new library record.
- **Browse/Load** — click **Library** in the app header; hover a tile → **Load**.
- **Delete** — hover a tile → red trash button → confirm.
- **Search** — type in the search box to filter by name or tag.

### Add a new field to the Character Card

1. **`src/types.ts`** — add to `CharacterCard` + `DEFAULT_CHARACTER`.
2. **`src/lib/ai.ts`** — add to `userPrompt`, `CHARACTER_CARD_JSON_SCHEMA.properties` + `required`, `KNOWN_CARD_FIELDS`.
3. **`src/components/CharacterEditor.tsx`** — add `<Input>` or `<Textarea>` in the appropriate tab.

### Add a new PhysicalAppearance sub-field

1. **`src/types.ts`** — add to `PhysicalAppearance`, `DEFAULT_APPEARANCE`, update `composeDescription()`.
2. **`src/lib/ai.ts`** — add `appearance_<field>` to `userPrompt`, schema, `KNOWN_CARD_FIELDS`, appearance extraction block, `generateImagePrompt()` appearance parts, `FIELD_LABELS`, `RegenerableField`, and `APPEARANCE_GUIDANCE`.
3. **`src/components/CharacterEditor.tsx`** — add `<Input>` with `handleAppearanceChange()` and `<RegenButton>`.

### Cancel an in-progress generation

Click **Stop** button (shown when `isGenerating`). Calls `abortControllerRef.current?.abort()` + `abortGeneration()`. `AbortError` is silently swallowed.

---
## 7. Troubleshooting

| Problem | Solution |
|---|---|
| "Failed to fetch" | Server not running or wrong port in `VITE_LOCAL_AI_URL` |
| "Did not return valid JSON" | Use instruct-tuned model; check `[ai.ts] Raw content:` in DevTools |
| Fields cut off / truncated | Increase `--max_length` in KoboldCpp; app requests up to 4000 tokens |
| Undo not working | Ensure mutations go through `set` from `useCardHistory`; click outside text fields first |
| "Generate Portrait" always disabled | Requires KoboldCpp with `--sdmodel`; need non-empty image prompt; `hasTxt2Img` must be true |
| Token counts show 0 | KoboldCpp only; `TokenBadge` hides automatically on other servers |
| Library not saving | `card.name` must be set before saving |
| NSFW badge not showing | Checked via `isNsfw(record)` — either `record.nsfwMode` or NSFW tags trigger it |
| HMR not working in WSL | Set `DISABLE_HMR=true` in `.env.local` |
| `@/` alias not resolving | Alias root is project root, not `src/`. Both `vite.config.ts` and `tsconfig.json` must have it. |
| Portrait times out | 2-minute internal timeout in `generatePortrait()`; increase GPU offload or reduce resolution |
| Low `maxOutputLength` warning | Increase `--max_length` in KoboldCpp launcher flags; anything below 1500 will truncate output |

---
## 8. Continue Rules Reference

| File | Scope | Summary |
|---|---|---|
| `CONTINUE.md` | Always | This project guide |
| `ai-output-parsing.md` | `src/lib/ai.ts` | Always strip markdown fences before `JSON.parse()` |
| `import-path-aliases.md` | `**/*.{ts,tsx}` | Always use `@/` — no relative paths |
| `strict-typescript.md` | `**/*.{ts,tsx}` | No `eslint-disable`; prefix unused vars with `_` |
| `styling-and-ui.md` | `**/*.tsx` | Tailwind only; `cn()` for conditionals; prefer shadcn primitives |
| `character-card-schema-updates.md` | Agent Requested | Checklist when adding new card fields |

---
## 9. References

- [Character Card V3 Spec](https://github.com/character-card-spec/character-card-spec-v3)
- [SillyTavern Character Card Docs](https://docs.sillytavern.app/usage/core-concepts/character-design/)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Tailwind CSS v4 Docs](https://tailwindcss.com/docs)
- [KoboldCpp GitHub](https://github.com/LostRuins/koboldcpp)
- [KoboldCpp API Docs](https://lite.koboldai.net/koboldcpp_api)
- [React 19 Docs](https://react.dev/)
- [Vite Env Variables](https://vite.dev/guide/env-and-mode)
