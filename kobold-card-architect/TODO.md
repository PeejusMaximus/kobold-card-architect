# Kobold Card Architect — Feature TODO

> Last updated to reflect current codebase state.
> Items are grouped by tier and ordered by implementation priority within each tier.
> The lorebook AI generator, NSFW pipeline, portrait generation, and CCv3 export are all **done**.

---

## Tier 1 — High Impact, Core Experience

### 1. Per-Field Regeneration
**Status:** ✅ Done  
**Effort:** ~4h  
**Files:** `src/lib/ai.ts`, `src/components/CharacterEditor.tsx`

A small ✨ icon button on each `<Textarea>` (appears on hover next to the label) that re-asks the AI to rewrite just that one field using the rest of the card as context. Currently users have to nuke the entire card and re-roll to fix one bad field.

**Implementation notes:**
- New `regenerateField(field, card, nsfw?, signal?)` export in `src/lib/ai.ts`
- Targeted prompt: `"Rewrite only the '{{field}}' field for this character. Return ONLY the new value as a plain string — no JSON, no markdown, no preamble."`
- Include card summary (name, personality snippet, scenario snippet, tags) as context
- NSFW mode flows through — same addendum pattern as `generateCharacter()`
- Returns a plain string (not JSON), so no sanitisation pipeline needed — just strip markdown fences
- Per-field abort via a `Map<string, AbortController>` ref so multiple fields can't interfere
- A `reGeneratingField: string | null` state drives the spinner on the correct button
- Fields that support it: `personality`, `scenario`, `first_mes`, `mes_example`, `system_prompt`, `post_history_instructions`, `creator_notes`, all appearance fields, `alternate_greetings[i]`, `group_only_greetings[i]`
- New internal `RegenButton` component: `<button>` with `Wand2` icon, shown inline next to the field label, hidden when `isGenerating` (full card gen) is true

---

### 2. Undo / Redo
**Status:** Not started  
**Effort:** ~2h  
**Files:** `src/hooks/useCardHistory.ts` (new), `src/components/CharacterEditor.tsx`

Every state mutation is currently irreversible. A ring-buffer history of the last 30 `CharacterCard` snapshots with `Ctrl+Z` / `Ctrl+Y` support.

**Implementation notes:**
- New `src/hooks/useCardHistory.ts` — exports `{ card, set, undo, redo, canUndo, canRedo }`
- Internal state: `past: CharacterCard[]`, `present: CharacterCard`, `future: CharacterCard[]`
- `set(next)` pushes `present` to `past`, clears `future`, caps `past` at 30 entries
- `undo()` pops from `past` into `present`, pushes old `present` to `future`
- `redo()` pops from `future` into `present`, pushes old `present` to `past`
- Replace `const [card, setCard]` in `CharacterEditor` with the hook
- `useEffect` keyboard listener: `Ctrl+Z` → `undo()`, `Ctrl+Y` / `Ctrl+Shift+Z` → `redo()`
- Add `Undo` / `Redo` icon buttons (`Undo2`, `Redo2` from lucide) to the toolbar row alongside New/Import/Export
- Buttons disabled when `!canUndo` / `!canRedo`
- Token count debounce refs and `abortControllerRef` stay outside history — they're ephemeral

---

### 3. Character Library
**Status:** Not started  
**Effort:** ~1 day  
**Files:** `src/lib/library.ts` (new), `src/components/LibraryDrawer.tsx` (new), `src/components/CharacterEditor.tsx`, `src/App.tsx`

Persistent local gallery so work survives page refreshes. IndexedDB for storage (portraits are ~200–500KB each — too large for localStorage).

**Implementation notes:**
- New `src/lib/library.ts` — thin IndexedDB wrapper:
  - DB name: `kca-library`, object store: `characters`, key: `id` (auto-increment)
  - Each record: `{ id, name, tags, nsfwMode, savedAt, card: CharacterCard }`  
  - Exports: `saveCard(card)`, `loadAllCards()`, `deleteCard(id)`, `getCard(id)`
- New `src/components/LibraryDrawer.tsx`:
  - Slides in from the left as an overlay (not a route change)
  - Grid of portrait thumbnails: `<img src={card.avatar} />` or the initial letter placeholder
  - Each tile shows: name, tags (up to 3), "Modified X days ago"
  - NSFW cards get a rose border tint on the tile
  - Actions: **Load** (replaces current card, asks for confirmation if card is dirty), **Delete** (with confirm dialog)
  - Search bar filters by name and tags
- **Save to Library** button in the main toolbar (between New and Import)
- Library drawer trigger: `Library` icon button in the header (or left-edge of the editor)
- On load from library, restore `nsfwMode` to match the saved card's mode

---

### 4. In-App Test Chat
**Status:** Not started  
**Effort:** ~1 day  
**Files:** `src/lib/ai.ts`, `src/components/ChatPanel.tsx` (new), `src/components/CharacterEditor.tsx`

A collapsible chat panel below the card preview in the right column. Closes the generate→preview→test→refine loop entirely without leaving the app.

**Implementation notes:**
- New `chatWithCharacter(card, history, userMessage, signal?)` in `src/lib/ai.ts`:
  - System message built from: `system_prompt` + `personality` + `description` + `scenario`
  - `post_history_instructions` appended as a final user-role injection after the last user message (correct ST behavior)
  - Returns a plain string (the character's reply)
  - Streaming optional but not required for v1
- New `src/components/ChatPanel.tsx`:
  - Toggle open/closed via a `MessageSquare` button in the right column header
  - Message list: assistant bubbles on left (character portrait thumbnail), user bubbles on right
  - First message pre-seeded from `card.first_mes` when panel opens or card changes
  - Input field + Send button at the bottom; `Enter` to send, `Shift+Enter` for newline
  - **Reset** button to clear history and re-seed `first_mes`
  - Renders `*asterisk actions*` in italic, `"quoted speech"` in normal weight (simple regex transform)
  - Token usage shown per-reply if KoboldCpp is active (use existing `countTokens`)
- Panel is disabled / shows a hint when `!card.name` or `!card.first_mes`
- Chat history is session-only — not persisted (localStorage would bloat quickly)

---

## Tier 2 — Polish & Power User Features

### 5. Tag Chip Input with Autocomplete
**Status:** Not started  
**Effort:** ~2h  
**Files:** `src/components/CharacterEditor.tsx` (or extract `src/components/TagInput.tsx`)

The current tags UI is an awkward inline-input-per-tag grid. Replace with proper chip input and autocomplete dropdown.

**Implementation notes:**
- New `TagInput` component (can live at top of `CharacterEditor.tsx` like `FormatButton` / `TokenBadge`)
- Props: `value: string[]`, `onChange: (tags: string[]) => void`, `nsfwMode?: boolean`
- Chips render as `flex-wrap` pill badges with `×` dismiss button each
- Typing in the input field filters a static `SUGGESTED_TAGS` list (~60 entries):
  ```
  Fantasy, Sci-Fi, Modern, Historical, Horror, Romance, Slice of Life, Isekai,
  Cyberpunk, Post-Apocalyptic, Mystery, Adventure, Thriller, Comedy,
  Tsundere, Kuudere, Yandere, Dandere, Genki, Stoic, Anti-Hero, Villain,
  Mentor, Rival, Childhood Friend, Royalty, Warrior, Mage, Rogue, Healer,
  Human, Elf, Dwarf, Demon, Android, Vampire, Werewolf, Dragon,
  NSFW, Explicit, Adult Content, SFW, Non-Sexual,
  OC, Fandom, Anime, Game, Book, Movie,
  English, Short Description, Long Description, ...
  ```
- Dropdown shows up to 6 filtered suggestions; clicking one adds the tag and clears input
- `Enter` key adds the raw typed value as a tag (allows custom tags not in the list)
- NSFW tags (`nsfw`, `explicit`, `adult content`) render in rose colour, matching card preview
- Replaces the entire tags section in the Advanced tab

---

### 6. Generation Diff / Cherry-Pick View
**Status:** Not started  
**Effort:** ~4h  
**Files:** `src/components/CharacterEditor.tsx`, `src/components/DiffDialog.tsx` (new)

Snapshot the card before each full generation. After generation completes, offer a diff dialog where the user can cherry-pick which fields to keep from the new generation vs. the previous card.

**Implementation notes:**
- `previousCardRef = React.useRef<CharacterCard | null>(null)` — set to `{ ...card }` at the start of `handleGenerate()`, before the `await`
- After successful generation, if `previousCardRef.current` differs from the new card, set `diffOpen: true`
- New `DiffDialog` component:
  - Lists only fields that actually changed (string compare)
  - Each changed field shown as two-column: **Previous** (muted, struckthrough) | **New** (highlighted)
  - Checkbox or **Keep New** / **Restore Old** button per field
  - **Accept All** and **Restore All** quick actions in the footer
  - Appearance sub-fields shown as a single collapsed group (expand to see individual fields)
- Dialog is optional — a **"Show Diff"** button appears in the toolbar after generation completes rather than auto-showing (less disruptive)
- Store the diff availability in `hasDiff: boolean` state; clear on next generation or manual edit

---

### 7. Prompt Template Editor
**Status:** Not started  
**Effort:** ~3h  
**Files:** `src/components/SettingsDialog.tsx` (new), `src/lib/ai.ts`, `src/App.tsx`

Expose the generation system prompt and user prompt template as editable text in a Settings dialog. Power users can tune generation without touching source code.

**Implementation notes:**
- New `src/components/SettingsDialog.tsx` — triggered by a `Settings` (gear) icon button in the `App.tsx` header
- Two textarea sections: **System Prompt** and **User Prompt Template**
- localStorage keys: `kca-system-prompt`, `kca-user-prompt-template`
- **Reset to Default** button per section
- In `generateCharacter()`, read `localStorage.getItem("kca-system-prompt")` before constructing the prompt; use stored value if present and non-empty
- User prompt template supports `{{genre}}`, `{{archetype}}`, `{{additionalInfo}}`, `{{nsfw}}` interpolation tokens that get replaced at generation time
- Add a **Generation Parameters** section to the same dialog:
  - Temperature slider (0.1 – 2.0, step 0.05) — stored in `kca-temperature`
  - `top_p` slider (0.1 – 1.0, step 0.05) — stored in `kca-top-p`
  - These override the hardcoded `0.8` / `0.92` values in `generateCharacter()`
- The dialog also houses any future global settings (poll interval, default genre/archetype, etc.)

---

### 8. Shareable Card URL
**Status:** Not started  
**Effort:** ~1h  
**Files:** `src/lib/cardio.ts`, `src/components/CharacterEditor.tsx`

Encode the card JSON (minus avatar — too large) in the URL hash so cards can be shared as a single link with zero infrastructure.

**Implementation notes:**
- `exportCardAsUrl(card): string` in `cardio.ts`:
  - Strip `avatar` from card, `JSON.stringify`, `btoa(encodeURIComponent(...))` (handles Unicode)
  - Return `${window.location.origin}${window.location.pathname}#card=<b64>`
- `importCardFromUrl(): CharacterCard | null` in `cardio.ts`:
  - Read `window.location.hash`, match `#card=(.+)`, `decodeURIComponent(atob(...))`, `JSON.parse`
  - Merge with `DEFAULT_CHARACTER` via `normaliseRawCard()` (already in `cardio.ts`)
  - Return `null` on any error
- In `CharacterEditor` (or `App.tsx`) `useEffect` on mount: call `importCardFromUrl()` — if non-null, load it and clear the hash (`history.replaceState(null, '', window.location.pathname)`)
- **Share** button (`Share2` icon) in the Export dialog — calls `exportCardAsUrl()` and copies to clipboard, shows a "Link copied!" toast
- ⚠️ Note: base64 of a full card JSON is ~4–6KB — well within URL limits for all major browsers

---

### 9. Live Token Budget Bar
**Status:** Not started  
**Effort:** ~1h  
**Files:** `src/components/CharacterEditor.tsx`

A horizontal progress bar in the AI Architect card showing total token usage across all card fields vs. the server's context length. Makes the existing (but hidden) `tokenCounts` state legible.

**Implementation notes:**
- Sum all values in `tokenCounts` state (already populated per-field via `countTokens()`)
- Compare against `serverStatus.maxContextLength` (already in state)
- Only render when `serverStatus.online && serverStatus.maxContextLength`
- A `<progress>` or `<div>` with `width: X%` inside a grey track:
  ```
  Context budget  ████████░░░░░░  1,847 / 4,096 tok
  ```
- Colour-coded: `bg-emerald-500` < 50%, `bg-amber-500` 50–80%, `bg-rose-500` > 80%
- Position: inside `<CardFooter>` of the AI Architect card, above the Generate button row
- Hidden when `tokenCounts` is empty (KoboldCpp offline, no fields have been typed yet)

---

### 10. Import Standalone Worldinfo into Lorebook
**Status:** Not started  
**Effort:** ~2h  
**Files:** `src/lib/cardio.ts`, `src/components/LorebookView.tsx`

The reverse of the existing **Export Worldinfo** button — load a KoboldLite `.json` world info file into the embedded lorebook. Entries are appended, not replaced.

**Implementation notes:**
- `importLorebookFromJson(file: File): Promise<CharacterBookEntry[]>` in `cardio.ts`
- Handles both KoboldLite format `{ worldinfo: [...] }` and raw CCv3 `{ entries: [...] }` arrays
- Field mapping (inverse of export): `key` (comma-split) → `keys[]`, `keysecondary` → `secondary_keys[]`, `wep` (bool) → `position`, `num` → `insertion_order`, `uid` → `id`, `content`, `comment`
- **Import Worldinfo** `FormatButton` added to `LorebookView` header row (next to Export Worldinfo)
- Hidden file input (`accept=".json"`) triggered programmatically
- Appended entries auto-expanded in the accordion (same pattern as AI generation)
- Show count of imported entries in a temporary success message: "Imported 12 entries"

---

## Tier 3 — Distinctive / Niche Features

### 11. Animated Card Preview
**Status:** Not started  
**Effort:** ~1h  
**Files:** `src/components/CharacterEditor.tsx`

Small motion touches that make the preview panel feel alive.

**Implementation notes:**
- Portrait: subtle `box-shadow` pulse animation (`animate-pulse` on the border ring) while `isGenerating` is true — signals the card is being written
- `first_mes` in the placeholder view: use `motion/react`'s `AnimatePresence` + character-by-character stagger when the field populates (only when it transitions from empty → non-empty, not on every keystroke)
- Tags: `AnimatePresence` so new tags animate in with a small scale+fade rather than popping in
- Portrait: `motion.img` with `initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }}` transition when `card.avatar` first appears (after portrait gen or upload)
- All animations respect `prefers-reduced-motion` — wrap in a check or use Framer's built-in `useReducedMotion()`

---

### 12. Lorebook Entry Drag-to-Reorder
**Status:** Not started  
**Effort:** ~2h  
**Files:** `src/components/LorebookView.tsx`, `package.json`

Drag handles on lorebook entries so users can reorder them visually instead of editing `insertion_order` numbers manually.

**Implementation notes:**
- Add `@dnd-kit/core` and `@dnd-kit/sortable` (~30KB gzipped combined — acceptable)
- Wrap the entry list in `<DndContext>` + `<SortableContext>`
- Each entry row gets a `useSortable()` hook; drag handle is a `GripVertical` icon button on the left of the header row
- On drag end, reorder the `entries` array and reassign `insertion_order` values (`i * 10`)
- Add `@dnd-kit/core` and `@dnd-kit/sortable` to the `vendor-ui` chunk in `vite.config.ts`

---

### 13. Batch Export (ZIP)
**Status:** Not started  
**Effort:** ~2h  
**Files:** `src/lib/library.ts`, `src/components/LibraryDrawer.tsx`

Requires **Character Library (#3)** to be implemented first.

Export all saved library cards as a ZIP file using the browser's native `CompressionStream` API — no extra dependencies.

**Implementation notes:**
- `exportAllAsZip(cards: CharacterCard[]): Promise<void>` in `src/lib/cardio.ts`
- Uses `CompressionStream` with `deflate-raw` + manual ZIP format construction (local file headers + central directory) — ~80 lines of pure browser code, zero deps
- Each card exported as `<name>.json` (CCv3 format, same as `exportCardAsJson`)
- **Export All as ZIP** button in `LibraryDrawer` footer, enabled when library has ≥ 2 cards
- Filename: `kca-export-YYYY-MM-DD.zip`
- ⚠️ `CompressionStream` is available in all modern browsers (Chrome 80+, Firefox 113+, Safari 16.4+) — no polyfill needed for the target audience

---

### 14. CCv3 `creator_notes_multilingual` Editor
**Status:** Not started  
**Effort:** ~2h  
**Files:** `src/components/CharacterEditor.tsx`

The `creator_notes_multilingual` field is part of the CCv3 spec and already typed in `src/types.ts` but has no UI. Add a simple multi-language notes editor.

**Implementation notes:**
- In the **Advanced** tab, below `creator_notes`, add a collapsible "Multilingual Notes" section
- A `+ Add Language` button opens a small inline form: ISO 639-1 code input + textarea
- Each existing language shown as a row: language code badge + textarea + delete button
- Common language codes shown as quick-add chips: `en`, `de`, `fr`, `ja`, `zh`, `ko`, `es`, `pt`, `ru`
- Stored as `card.creator_notes_multilingual: Record<string, string>`
- Exported as-is in the CCv3 envelope (already handled by `buildCcv3Json`)

---

## Completed Features

| Feature | Notes |
|---|---|
| ✅ Full character generation | 5-pass JSON sanitisation, GBNF grammar constraints, abort |
| ✅ NSFW generation mode | Persisted to `localStorage`, full prompt pipeline |
| ✅ Per-field token counting | Debounced, KoboldCpp only, colour-coded badges |
| ✅ Portrait generation | A1111-compatible SD endpoint, Anima defaults |
| ✅ Image prompt generation | Prose-based, NSFW-aware quality prefix |
| ✅ CCv3 JSON export | Full envelope, timestamps, appearance composed |
| ✅ CCv3 + V2 PNG export | Dual chunk embedding, placeholder canvas |
| ✅ JSON + PNG import | V1/V2/V3 normalisation, legacy backstory seeding |
| ✅ Lorebook editor | Full accordion UI, all CCv3 entry fields |
| ✅ AI lorebook generation | Batch, categories, NSFW, abort, skeleton placeholders |
| ✅ Lorebook export (worldinfo) | KoboldLite-compatible format |
| ✅ KoboldCpp status bar | Polling, capabilities, token usage, speed, queue |
| ✅ Light/dark theme | `localStorage` persist, system preference fallback |
| ✅ Alternate greetings | UI + AI generation toggle |
| ✅ Group-only greetings | UI + AI generation toggle (CCv3) |
| ✅ Physical appearance editor | Structured fields → composed `description` |
| ✅ Generation cancel | AbortController + KoboldCpp `/api/extra/abort` |
| ✅ Per-field regeneration | `RegenButton` on 18 fields, `regenerateField()` in ai.ts, per-field AbortController map |

---

## Known Issues / Tech Debt

- ~~`plan.md` in the project root is stale~~ **Neutralised** — delete the file manually.
- ~~`src/lib/gemini.ts` is a deprecated shim~~ **Confirmed safe** — nothing imports it. Delete the file manually.
- ~~`kobold.ts` `generatePortrait` has a syntax error on the `negative_prompt` line~~ **Fixed** — default Anima negative prompt restored.
- ~~The `position` field in lorebook entries uses a raw `<select>` element~~ **Fixed** — migrated to shadcn `Select` (`components/ui/select.tsx` added via shadcn CLI).
- `CharacterEditor.tsx` is now ~1734 lines (grew significantly with per-field regen). Consider extracting `AppearanceEditor.tsx` and `AiArchitectPanel.tsx` as follow-on refactors for readability.