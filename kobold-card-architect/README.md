<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Kobold Card Architect

**AI-assisted character card generator and editor for KoboldLite & SillyTavern**

100% local · no API keys · no cloud · complete privacy

</div>

---

## Overview

Kobold Card Architect is a browser-based tool for creating, editing, importing, and exporting AI roleplay character cards. Cards are exported in **Character Card V3 (CCv3)** format, fully compatible with SillyTavern and KoboldLite.

All AI generation runs against a **local inference server** — KoboldCpp, LM Studio, or Ollama. No data leaves your machine.

### Features

- 🤖 **AI character generation** — genre + archetype + optional context → complete CCv3 card in one click
- 📚 **AI lorebook generation** — generate keyword-triggered world info entries (people, places, events, items, concepts) from the character's existing data; entries are appended to the lorebook, never overwritten
- 🔞 **NSFW mode** — explicit adult content generation across all AI features; persisted across sessions
- 🧑‍🎨 **Structured appearance editor** — dedicated fields for gender, age, build, face, hair, eyes, skin, marks, clothing, voice, and backstory; auto-composed into the `description` field
- 🗂️ **Lorebook editor** — keyword-triggered context entries with enable/disable toggles, position control, selective matching, and standalone world info export
- 🖼️ **Portrait generation** — generate a Stable Diffusion portrait via KoboldCpp when an SD model is loaded
- 🎨 **Image prompt generator** — builds a comma-separated SD prompt from the card's appearance, personality, and scenario
- 📊 **Server status bar** — live KoboldCpp status: model name, context length, eval speed, max output tokens, busy state, capability badges (Vision, Img Gen, TTS, STT, Embed, Search)
- 🧵 **Token counter** — real-time per-field token counts via KoboldCpp's tokenizer
- 📥 **Import** — JSON (V1 / V2 / CCv3) and PNG card files (SillyTavern / KoboldLite)
- 📤 **Export** — CCv3 JSON and CCv3 PNG (dual `ccv3` + `chara` chunks for maximum compatibility)
- 🌓 **Light / dark theme** — persisted to `localStorage`

---

## Prerequisites

- **Node.js** v18+
- A running local AI server:

| Server | Default URL | Full Feature Support |
|---|---|---|
| [KoboldCpp](https://github.com/LostRuins/koboldcpp) | `http://127.0.0.1:5001/v1` | ✅ Recommended — all features |
| [LM Studio](https://lmstudio.ai/) | `http://127.0.0.1:1234/v1` | ⚠ Generation only |
| [Ollama](https://ollama.com/) | `http://127.0.0.1:11434/v1` | ⚠ Generation only |

Server status polling, token counting, grammar-constrained JSON generation, and portrait generation require **KoboldCpp** and degrade gracefully on other servers.

---

## Getting Started

```bash
cd kobold-card-architect
npm install
npm run dev
```

The app runs at **http://localhost:3000**.

### Environment Configuration (Optional)

The app defaults to KoboldCpp at `http://localhost:5001/v1`. To point it at a different server, create a `.env.local` file in the `kobold-card-architect/` directory:

```env
# kobold-card-architect/.env.local
VITE_LOCAL_AI_URL=http://127.0.0.1:1234/v1
```

Restart `npm run dev` after changing this file.

---

## Scripts

```bash
npm run dev      # start dev server at http://localhost:3000
npm run build    # production build with vendor chunk splitting → dist/
npm run preview  # preview the production build locally
npm run lint     # TypeScript type-check (tsc --noEmit)
npm run clean    # delete the dist/ directory
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build Tool | Vite 6 |
| Styling | Tailwind CSS v4 + shadcn/ui (Base UI primitives) |
| AI Integration | Native `fetch` → OpenAI-compatible `/v1/chat/completions` |
| KoboldCpp API | Native `fetch` → `/api/extra/*` + `/sdapi/v1/*` |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |

---

## Portrait Generation

Kobold Card Architect can generate character portraits entirely locally when KoboldCpp is running with a Stable Diffusion model:

1. Launch KoboldCpp with a `.safetensors` SD model: `--sdmodel path/to/model.safetensors`
2. The status bar will show an **Img Gen** badge when the SD model is detected.
3. Fill in the card fields, then click **Generate Image Prompt** to build an SD prompt from the character's appearance and personality.
4. Click **Generate Portrait** to render the image. It is automatically set as the card's avatar.
5. Export as PNG to embed both the portrait and card data in a single file.

---

## Card Format

Exported JSON files use the **CCv3 envelope**:
```json
{ "spec": "chara_card_v3", "spec_version": "3.0", "data": { ... } }
```

Exported PNG files embed two tEXt chunks as required by the CCv3 spec:
- `ccv3` — full CCv3 envelope (primary, for V3-aware readers)
- `chara` — V2 backfill (for legacy SillyTavern / KoboldLite)

Imported files can be V1 flat objects, V2 envelopes, or CCv3 envelopes — all are normalised and merged with `DEFAULT_CHARACTER`.

---

## References

- [Character Card V3 Spec](https://github.com/character-card-spec/character-card-spec-v3)
- [SillyTavern Character Card Docs](https://docs.sillytavern.app/usage/core-concepts/character-design/)
- [KoboldCpp GitHub](https://github.com/LostRuins/koboldcpp)
- [KoboldCpp API Docs](https://lite.koboldai.net/koboldcpp_api)
