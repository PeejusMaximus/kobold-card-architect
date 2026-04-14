/**
 * kobold.ts — KoboldCpp native API client
 *
 * Wraps the KoboldCpp-specific /api/extra and /api/v1 endpoints.
 * The OpenAI-compatible /v1/* endpoints are handled separately in ai.ts.
 *
 * All functions read the base URL from the same VITE_LOCAL_AI_URL env var
 * used by ai.ts, but strip the trailing /v1 path so we can reach /api/*.
 */

const RAW_URL = import.meta.env.VITE_LOCAL_AI_URL || "http://localhost:5001/v1";

/** Base URL without the /v1 suffix — e.g. "http://localhost:5001" */
const KOBOLD_BASE = RAW_URL.replace(/\/v1\/?$/, "");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface KoboldServerStatus {
  /** Whether the server responded at all */
  online: boolean;
  /** KoboldCpp version string — date-based, e.g. "2025.06.03" */
  version?: string;
  /** Currently loaded model identifier */
  model?: string;
  /** True context length available (tokens) — from /api/extra/true_max_context_length */
  maxContextLength?: number;
  /** Tokens evaluated per second in the last generation (KcppPerf: last_eval_speed) */
  evalSpeed?: number;
  /** Whether a generation is currently running. Per KcppPerf schema: idle===0 means busy, idle===1 means idle. Also true when queue > 0. */
  busy?: boolean;
  /** Number of requests queued behind the current one */
  queue?: number;
  /** Number of prompt tokens processed in the last request (KcppPerf: last_input_count) */
  lastInputTokens?: number;
  /** Number of tokens generated in the last request (KcppPerf: last_token_count) */
  lastOutputTokens?: number;
  /**
   * Stop reason for the last generation (KcppPerf: stop_reason).
   * -1=INVALID, 0=OUT_OF_TOKENS, 1=EOS_TOKEN_HIT, 2=CUSTOM_STOPPER
   */
  lastStopReason?: number;
  // ── Capability flags from /api/extra/version ────────────────────────────
  /** True if the server has a vision/multimodal model loaded */
  hasVision?: boolean;
  /** True if a Stable Diffusion model is loaded for image generation */
  hasTxt2Img?: boolean;
  /** True if a Whisper model is loaded for transcription */
  hasTranscribe?: boolean;
  /** True if TTS is available */
  hasTts?: boolean;
  /** True if embeddings endpoint is available */
  hasEmbeddings?: boolean;
  /** True if web search is enabled */
  hasWebSearch?: boolean;
  /** True if multiplayer/collaborative mode is enabled */
  hasMultiplayer?: boolean;
  /**
   * Maximum output tokens per generation request — from /api/v1/config/max_length.
   * Note: /api/v1/config/max_context_length returns the public-facing (possibly capped)
   * context length; /api/extra/true_max_context_length returns the real launcher value.
   * If maxOutputLength is below ~1500, character card JSON is likely to be truncated.
   */
  maxOutputLength?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polls the KoboldCpp server for health, model info, and performance data.
 * Returns `{ online: false }` on any network or parse error — never throws.
 */
export async function getServerStatus(): Promise<KoboldServerStatus> {
  try {
    const [versionRes, modelRes, perfRes, contextRes, maxLenRes] = await Promise.all([
      fetch(`${KOBOLD_BASE}/api/extra/version`),
      fetch(`${KOBOLD_BASE}/api/v1/model`),
      fetch(`${KOBOLD_BASE}/api/extra/perf`),
      fetch(`${KOBOLD_BASE}/api/extra/true_max_context_length`),
      fetch(`${KOBOLD_BASE}/api/v1/config/max_length`),
    ]);

    if (!versionRes.ok) return { online: false };

    const version  = await versionRes.json();
    const model    = modelRes.ok    ? await modelRes.json()    : null;
    const perf     = perfRes.ok     ? await perfRes.json()     : null;
    const context  = contextRes.ok  ? await contextRes.json()  : null;
    const maxLen   = maxLenRes.ok   ? await maxLenRes.json()   : null;

    // Strip the "koboldcpp/" vendor prefix from the model name for display
    const rawModel: string = model?.result ?? "";
    const displayModel = rawModel.replace(/^koboldcpp\//i, "");

    // Per KcppPerf schema: idle is an integer — 0 = busy, 1 = idle
    const isBusy = perf ? (perf.idle === 0 || perf.queue > 0) : undefined;

    return {
      online:           true,
      version:          version?.version,
      model:            displayModel || undefined,
      maxContextLength: context?.value,
      evalSpeed:        perf?.last_eval_speed ? Math.round(perf.last_eval_speed) : undefined,
      busy:             isBusy,
      queue:            perf?.queue ?? 0,
      lastInputTokens:  perf?.last_input_count,
      lastOutputTokens: perf?.last_token_count,
      lastStopReason:   perf?.stop_reason,
      // Capability flags from /api/extra/version
      hasVision:      version?.vision      === true,
      hasTxt2Img:     version?.txt2img     === true,
      hasTranscribe:  version?.transcribe  === true,
      hasTts:         version?.tts         === true,
      hasEmbeddings:  version?.embeddings  === true,
      hasWebSearch:   version?.websearch   === true,
      hasMultiplayer: version?.multiplayer === true,
      // Max output tokens from /api/v1/config/max_length
      maxOutputLength: maxLen?.value,
    };
  } catch {
    return { online: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Max output length
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the server's current max output token limit from /api/v1/config/max_length.
 * Used by ai.ts to cap max_tokens at whatever the server will actually honour.
 * Returns null on error — never throws.
 */
export async function getMaxOutputLength(): Promise<number | null> {
  try {
    const res = await fetch(`${KOBOLD_BASE}/api/v1/config/max_length`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.value === "number" ? data.value : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token counting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counts the exact number of tokens in `text` using KoboldCpp's tokenizer.
 * Returns 0 on error — never throws.
 */
export async function countTokens(text: string): Promise<number> {
  if (!text) return 0;
  try {
    const res = await fetch(`${KOBOLD_BASE}/api/extra/tokencount`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ prompt: text }),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data?.value ?? 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Abort generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends an abort signal to KoboldCpp, stopping any in-progress generation.
 * Safe to call even when idle — never throws.
 */
export async function abortGeneration(): Promise<void> {
  try {
    await fetch(`${KOBOLD_BASE}/api/extra/abort`, { method: "POST" });
  } catch {
    // Intentionally silent — server may already be idle
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Image generation (sdapi/v1 — A1111-compatible)
// ─────────────────────────────────────────────────────────────────────────────

export interface Txt2ImgParams {
  /** Positive prompt describing the image. */
  prompt: string;
  /** Things to exclude from the image. */
  negative_prompt?: string;
  /** Diffusion steps. Default 9 (z-image/Turbo/LCM/Flux recommended). */
  steps?: number;
  /** Classifier-Free Guidance scale. Default 0.0 (z-image/Turbo/LCM/Flux recommended). */
  cfg_scale?: number;
  /** Output width in pixels. Must be an integer. Default 512. */
  width?: number;
  /** Output height in pixels. Must be an integer. Default 768 (portrait aspect). */
  height?: number;
  /** RNG seed. -1 = random. */
  seed?: number;
  /** Sampler name. Default "Euler" (z-image/Turbo/LCM/Flux recommended). */
  sampler_name?: string;
}

/**
 * Generates a portrait image via KoboldCpp's A1111-compatible
 * POST /sdapi/v1/txt2img endpoint.
 *
 * Requires KoboldCpp to have been launched with a Stable Diffusion
 * .safetensors model — check `hasTxt2Img` in KoboldServerStatus first.
 *
 * Returns a `data:image/png;base64,...` string ready to use as an img src.
 * Throws a descriptive Error on failure.
 */
export async function generatePortrait(params: Txt2ImgParams): Promise<string> {
  // SD generation on CPU can take 30–60s — use a generous timeout so the
  // browser doesn't silently drop the connection before the image arrives.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min

  let res: Response;
  try {
    res = await fetch(`${KOBOLD_BASE}/sdapi/v1/txt2img`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
      prompt:          params.prompt,
      negative_prompt: params.negative_prompt ??
        "worst quality, low quality, score_1, score_2, score_3, blurry, deformed, watermark, signature, text, jpeg artifacts",
      steps:        params.steps        ?? 9,
      cfg_scale:    params.cfg_scale    ?? 0.0,
      width:        params.width        ?? 512,
      height:       params.height       ?? 768,
      seed:         params.seed         ?? -1,
      sampler_name: params.sampler_name ?? "Euler",
        send_images:  true,
        save_images:  false,
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Portrait generation timed out after 2 minutes. Try a smaller resolution or enable GPU offload.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Portrait generation failed: ${res.status} ${res.statusText}` +
      (text ? ` — ${text}` : "")
    );
  }

  const data = await res.json();
  console.debug("[kobold.ts] txt2img response keys:", Object.keys(data ?? {}));
  console.debug("[kobold.ts] images array length:", data?.images?.length ?? "missing");
  console.debug("[kobold.ts] images[0] length:", data?.images?.[0]?.length ?? 0);

  const raw: string | undefined = data?.images?.[0];
  if (!raw) {
    // Log the full response so we can see what KoboldCpp actually returned
    console.error("[kobold.ts] txt2img returned no image. Full response:", JSON.stringify(data));
    throw new Error(
      "KoboldCpp returned no image data. " +
      "Possible causes: SD model still loading, not enough VRAM, or generation was suppressed by a safety filter. " +
      "Check the KoboldCpp console for errors."
    );
  }

  // Strip any embedded whitespace/newlines (MIME-wrapped base64 from some KoboldCpp builds)
  const b64 = raw.replace(/\s/g, "");

  // Some KoboldCpp builds already prepend the data URI prefix — don't double it
  if (b64.startsWith("data:")) return b64;

  return `data:image/png;base64,${b64}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grammar-constrained generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a JSON schema object into a GBNF grammar string via KoboldCpp's
 * /api/extra/json_to_grammar endpoint.
 *
 * Per the KoboldCpp API, the request body must be wrapped as
 * `{ schema: <json-schema> }` and the response grammar is returned in
 * `result` (with some older builds/extensions using `grammar`).
 *
 * The grammar can be passed as a `grammar` parameter in generation requests
 * to physically constrain the model to only output valid JSON matching the
 * schema — eliminating malformed output entirely.
 *
 * Returns `null` if the endpoint is unavailable or the conversion fails.
 */
export async function getGrammarFromSchema(
  schema: Record<string, unknown>
): Promise<string | null> {
  try {
    const res = await fetch(`${KOBOLD_BASE}/api/extra/json_to_grammar`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ schema }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.debug(
        `[kobold.ts] json_to_grammar unavailable or failed: ${res.status} ${res.statusText}`,
        errorText || "(no response body)"
      );
      return null;
    }

    const data = await res.json();
    const grammar = typeof data?.result === "string"
      ? data.result
      : typeof data?.grammar === "string"
        ? data.grammar
        : null;

    if (!grammar) {
      console.debug(
        "[kobold.ts] json_to_grammar returned an unexpected payload shape.",
        data
      );
      return null;
    }

    console.debug("[kobold.ts] json_to_grammar succeeded.");
    return grammar;
  } catch (error) {
    console.debug("[kobold.ts] json_to_grammar request failed.", error);
    return null;
  }
}
