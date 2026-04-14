import * as React from "react";
import { motion } from "motion/react";
import {
  Download,
  Upload,
  Sparkles,
  Plus,
  Trash2,
  FileJson,
  FileImage,
  RefreshCw,
  Info,
  ImagePlus,
  X,
  BookOpen,
  Link,
  ChevronDown,
  ChevronUp,
  Wand2,
  Copy,
  Check,
  FlameKindling,
  Wifi,
  WifiOff,
  Square,
  Cpu,
  Hash,
  FilePlus,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CharacterCard, CharacterBook, CharacterBookEntry,
  PhysicalAppearance, DEFAULT_APPEARANCE, composeDescription,
  DEFAULT_CHARACTER, DEFAULT_LOREBOOK_ENTRY,
} from "@/src/types";

import { generateCharacter, generateImagePrompt, regenerateField } from "@/src/lib/ai";
import { useCardHistory } from "@/src/hooks/useCardHistory";
import type { RegenerableField } from "@/src/lib/ai";
import {
  getServerStatus,
  countTokens,
  abortGeneration,
  generatePortrait,
  type KoboldServerStatus,
} from "@/src/lib/kobold";

/** Warn in the UI if max output is below this. Mirrors MIN_RECOMMENDED_TOKENS in ai.ts. */
const MIN_RECOMMENDED_TOKENS = 1500;
import {
  importCardFromJson,
  importCardFromPng,
  exportCardAsJson,
  exportCardAsPng,
} from "@/src/lib/cardio";
import { LorebookView } from "./LorebookView";

// ─────────────────────────────────────────────────────────────────────────────
// FormatButton — icon tile used inside Import / Export dialogs
// ─────────────────────────────────────────────────────────────────────────────

function FormatButton({
  icon,
  label,
  sublabel,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      <div className="text-primary/60">{icon}</div>
      <div>
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TokenBadge — small token count pill shown next to textarea labels
// ─────────────────────────────────────────────────────────────────────────────

function TokenBadge({ count }: { count: number }) {
  // Hide the badge entirely when count is 0 — this happens when KoboldCpp is
  // offline (countTokens returns 0) so we don't show a misleading "0 tok" pill.
  if (!count) return null;
  const colour =
    count > 600 ? "text-rose-500 bg-rose-500/10" :
    count > 300 ? "text-amber-500 bg-amber-500/10" :
                  "text-muted-foreground bg-muted";
  return (
    <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded-full tabular-nums", colour)}>
      {count} tok
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RegenButton — wand icon shown next to field labels for per-field regen
// ─────────────────────────────────────────────────────────────────────────────

function RegenButton({
  fieldKey,
  reGeneratingField,
  isGenerating,
  onClick,
}: {
  fieldKey: string;
  reGeneratingField: string | null;
  isGenerating: boolean;
  onClick: () => void;
}) {
  const isThis = reGeneratingField === fieldKey;
  const anyRegen = reGeneratingField !== null;
  const disabled = isGenerating || (anyRegen && !isThis);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={isThis ? "Regenerating\u2026" : "Regenerate this field"}
      className={cn(
        "ml-1 inline-flex items-center justify-center rounded p-0.5 transition-colors",
        "text-muted-foreground hover:text-primary hover:bg-accent",
        "disabled:opacity-30 disabled:cursor-not-allowed",
        isThis && "text-primary",
      )}
    >
      <Wand2 className={cn("h-3 w-3", isThis && "animate-spin")} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CharacterEditor
// ─────────────────────────────────────────────────────────────────────────────

export function CharacterEditor() {
  const { card, set: setCard, undo, redo, canUndo, canRedo } = useCardHistory(DEFAULT_CHARACTER);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [streamTokenCount, setStreamTokenCount] = React.useState(0);
  const [reGeneratingField, setReGeneratingField] = React.useState<string | null>(null);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [genRawOutput, setGenRawOutput] = React.useState<string | null>(null);
  const [rawCopied, setRawCopied] = React.useState(false);
  const [nsfwMode, setNsfwMode] = React.useState<boolean>(() => {
    try { return localStorage.getItem("kca-nsfw") === "true"; } catch { return false; }
  });
  const [includeAlternates, setIncludeAlternates]       = React.useState(false);
  const [includeGroupGreetings, setIncludeGroupGreetings] = React.useState(false);
  const [isExporting, setIsExporting]   = React.useState(false);

  // Server status
  const [serverStatus, setServerStatus] = React.useState<KoboldServerStatus>({ online: false });

  // Token counts for key fields
  const [tokenCounts, setTokenCounts] = React.useState<Record<string, number>>({});

  // AbortController ref for cancelling in-flight generation
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const fieldRegenRefsMap = React.useRef<Map<string, AbortController>>(new Map());
  const [importOpen, setImportOpen]     = React.useState(false);
  const [exportOpen, setExportOpen]     = React.useState(false);
  const [newCardOpen, setNewCardOpen]   = React.useState(false);
  
  // Application view state
  const [view, setView] = React.useState<'character' | 'lorebook'>('character');

  // Image prompt generation
  const [imagePrompt, setImagePrompt]               = React.useState("");
  const [isGeneratingPrompt, setIsGeneratingPrompt] = React.useState(false);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = React.useState(false);
  const [promptCopied, setPromptCopied]             = React.useState(false);
  const [genParams, setGenParams] = React.useState({
    genre: "Fantasy",
    archetype: "adventurer",
    additionalInfo: "",
  });

  // ── Server status polling ────────────────────────────────────────────────

  React.useEffect(() => {
    // Poll immediately on mount, then every 10 seconds
    const poll = () => getServerStatus().then(setServerStatus);
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, []);

  // ── Token counting ───────────────────────────────────────────────────────

  const updateTokenCount = React.useCallback(
    async (field: string, text: string) => {
      const count = await countTokens(text);
      setTokenCounts((prev) => ({ ...prev, [field]: count }));
    },
    []
  );

  // Debounced token count updater — 600ms after the user stops typing
  const tokenDebounceRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleTokenCount = React.useCallback(
    (field: string, text: string) => {
      clearTimeout(tokenDebounceRef.current[field]);
      tokenDebounceRef.current[field] = setTimeout(() => updateTokenCount(field, text), 600);
    },
    [updateTokenCount]
  );

  // Hidden file inputs
  const jsonImportRef  = React.useRef<HTMLInputElement>(null);
  const pngImportRef   = React.useRef<HTMLInputElement>(null);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  // ── Field helpers ────────────────────────────────────────────────────────

  const handleInputChange = (field: keyof CharacterCard, value: unknown) => {
    setCard((prev) => ({ ...prev, [field]: value }));
  };

  // ── Appearance helpers ───────────────────────────────────────────────────

  const getAppearance = (): PhysicalAppearance => {
    const ext = card.extensions?.appearance;
    if (ext && typeof ext === "object") return { ...DEFAULT_APPEARANCE, ...(ext as PhysicalAppearance) };
    return { ...DEFAULT_APPEARANCE };
  };

  const handleAppearanceChange = (field: keyof PhysicalAppearance, value: string) => {
    setCard((prev) => {
      const updated: PhysicalAppearance = { ...DEFAULT_APPEARANCE, ...(prev.extensions?.appearance as PhysicalAppearance ?? {}), [field]: value };
      return {
        ...prev,
        extensions: { ...prev.extensions, appearance: updated },
        description: composeDescription(updated),
      };
    });
  };

  const handleArrayChange = (
    field: "alternate_greetings" | "tags" | "group_only_greetings",
    index: number,
    value: string
  ) => {
    const next = [...card[field]];
    next[index] = value;
    setCard((prev) => ({ ...prev, [field]: next }));
  };

  const addArrayItem = (field: "alternate_greetings" | "tags" | "group_only_greetings") => {
    setCard((prev) => ({ ...prev, [field]: [...prev[field], ""] }));
  };

  const removeArrayItem = (field: "alternate_greetings" | "tags" | "group_only_greetings", index: number) => {
    setCard((prev) => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }));
  };



  // ── New card ─────────────────────────────────────────────────────────────

  const handleNewCard = () => {
    setCard({ ...DEFAULT_CHARACTER });
    setTokenCounts({});
    setImagePrompt("");
    setNewCardOpen(false);
  };

  // ── Undo / Redo keyboard shortcuts ──────────────────────────────────────

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key === "y") || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // ── Avatar ───────────────────────────────────────────────────────────────

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) =>
      setCard((prev) => ({ ...prev, avatar: ev.target?.result as string }));
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const clearAvatar = () => setCard((prev) => ({ ...prev, avatar: undefined }));

  // ── Import ───────────────────────────────────────────────────────────────

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const imported = await importCardFromJson(file);
      setCard(imported);
      setImportOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to import JSON card.");
    }
  };

  const handleImportPng = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { card: imported, avatarDataUrl } = await importCardFromPng(file);
      setCard({ ...imported, avatar: avatarDataUrl });
      setImportOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to import PNG card.");
    }
  };

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExportJson = () => {
    try {
      exportCardAsJson(card);
      setExportOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to export JSON.");
    }
  };

  const handleExportPng = async () => {
    setIsExporting(true);
    try {
      await exportCardAsPng(card);
      setExportOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to export PNG.");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Image Prompt Generation ──────────────────────────────────────────────

  const handleGenerateImagePrompt = async () => {
    setIsGeneratingPrompt(true);
    setGenError(null);
    try {
      const prompt = await generateImagePrompt(card, nsfwMode);
      setImagePrompt(prompt);
    } catch (err) {
      console.error(err);
      setGenError(
        err instanceof Error
          ? err.message
          : "Image prompt generation failed. Is your local AI server running?"
      );
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // ── Portrait Generation ─────────────────────────────────────────────────

  const handleGeneratePortrait = async () => {
    if (!imagePrompt) return;
    setIsGeneratingPortrait(true);
    setGenError(null);
    try {
      const dataUrl = await generatePortrait({ prompt: imagePrompt });
      setCard((prev) => ({ ...prev, avatar: dataUrl }));
    } catch (err) {
      console.error(err);
      setGenError(
        err instanceof Error
          ? err.message
          : "Portrait generation failed. Make sure KoboldCpp has a Stable Diffusion model loaded."
      );
    } finally {
      setIsGeneratingPortrait(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!imagePrompt) return;
    await navigator.clipboard.writeText(imagePrompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  // ── AI Generation ────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);
    setStreamTokenCount(0);
    setGenError(null);
    setGenRawOutput(null);
    try {
      const generated = await generateCharacter({
        ...genParams,
        nsfw: nsfwMode,
        signal: controller.signal,
        includeAlternateGreetings: includeAlternates,
        includeGroupGreetings,
        onProgress: (n) => setStreamTokenCount(n),
      });
      setCard((prev) => ({ ...prev, ...generated }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      const msg = err instanceof Error ? err.message : "Generation failed. Is your local AI server running?";
      // Extract raw output preview from error message if present
      const rawMatch = msg.match(/Raw output preview:\n([\s\S]*)$/);
      if (rawMatch) setGenRawOutput(rawMatch[1]);
      setGenError(msg);
    } finally {
      setIsGenerating(false);
      setStreamTokenCount(0);
      abortControllerRef.current = null;
    }
  };

  const handleAbort = async () => {
    abortControllerRef.current?.abort();
    await abortGeneration();
    setIsGenerating(false);
  };

  // ── Per-field regeneration ───────────────────────────────────────────────

  const handleRegenField = async (
    field: RegenerableField,
    arrayIndex?: number,
  ) => {
    if (isGenerating || reGeneratingField !== null) return;
    const existingAbort = fieldRegenRefsMap.current.get(field);
    existingAbort?.abort();
    const controller = new AbortController();
    fieldRegenRefsMap.current.set(field, controller);
    const fieldKey = arrayIndex !== undefined ? `${field}[${arrayIndex}]` : field;
    setReGeneratingField(fieldKey);
    try {
      const newValue = await regenerateField(field, card, nsfwMode, controller.signal);
      if (field.startsWith("appearance_")) {
        const subField = field.replace("appearance_", "") as keyof PhysicalAppearance;
        handleAppearanceChange(subField, newValue);
      } else if (field === "first_mes" && arrayIndex !== undefined) {
        setCard((prev) => {
          const alts = [...(prev.alternate_greetings ?? [])];
          alts[arrayIndex] = newValue;
          return { ...prev, alternate_greetings: alts };
        });
      } else if (field === "scenario" && arrayIndex !== undefined) {
        setCard((prev) => {
          const grps = [...(prev.group_only_greetings ?? [])];
          grps[arrayIndex] = newValue;
          return { ...prev, group_only_greetings: grps };
        });
      } else {
        setCard((prev) => ({ ...prev, [field]: newValue }));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[CharacterEditor] Per-field regen error:", err);
    } finally {
      setReGeneratingField(null);
      fieldRegenRefsMap.current.delete(field);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      {/* ── Server Status Bar ───────────────────────────────────────────── */}
      <div className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 mb-4 text-xs",
        serverStatus.online
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
          : "border-destructive/30 bg-destructive/5 text-destructive"
      )}>
        {/* Online / Offline indicator */}
        {serverStatus.online
          ? <Wifi className="h-3.5 w-3.5 shrink-0" />
          : <WifiOff className="h-3.5 w-3.5 shrink-0" />}
        <span className="font-semibold">
          {serverStatus.online ? "Server Online" : "Server Offline"}
        </span>

        {serverStatus.online && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-1 text-muted-foreground">
            {/* Model name */}
            {serverStatus.model && (
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                {serverStatus.model}
              </span>
            )}

            {/* Context length */}
            {serverStatus.maxContextLength && (
              <span className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {serverStatus.maxContextLength.toLocaleString()} ctx
              </span>
            )}

            {/* Eval speed */}
            {serverStatus.evalSpeed !== undefined && (
              <span>{serverStatus.evalSpeed} tok/s</span>
            )}

            {/* Max output length — warn if too low for a full card */}
            {serverStatus.maxOutputLength !== undefined && (
              <span className={cn(
                "flex items-center gap-1 font-medium",
                serverStatus.maxOutputLength < MIN_RECOMMENDED_TOKENS
                  ? "text-rose-500 dark:text-rose-400"
                  : "text-muted-foreground"
              )}>
                {serverStatus.maxOutputLength < MIN_RECOMMENDED_TOKENS && "⚠ "}
                {serverStatus.maxOutputLength.toLocaleString()} max out
              </span>
            )}

            {/* Last request token usage */}
            {serverStatus.lastInputTokens !== undefined && serverStatus.lastInputTokens > 0 && (
              <span className="tabular-nums">
                last: {serverStatus.lastInputTokens.toLocaleString()} in
                {serverStatus.lastOutputTokens !== undefined && (
                  <> / {serverStatus.lastOutputTokens.toLocaleString()} out</>
                )}
              </span>
            )}

            {/* Busy indicator */}
            {serverStatus.busy && (
              <span className="text-amber-500 dark:text-amber-400 font-medium flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Busy
                {(serverStatus.queue ?? 0) > 0 && ` (${serverStatus.queue} queued)`}
              </span>
            )}

            {/* Out-of-tokens warning from last generation */}
            {serverStatus.lastStopReason === 0 && (
              <span className="text-amber-500 dark:text-amber-400 font-medium">
                ⚠ Last generation hit token limit
              </span>
            )}

            {/* Capability badges */}
            <span className="flex items-center gap-1 ml-1">
              {serverStatus.hasVision    && <span className="bg-sky-500/15 text-sky-500 dark:text-sky-400 px-1.5 py-0.5 rounded-full font-medium">Vision</span>}
              {serverStatus.hasTxt2Img   && <span className="bg-violet-500/15 text-violet-500 dark:text-violet-400 px-1.5 py-0.5 rounded-full font-medium">Img Gen</span>}
              {serverStatus.hasTts       && <span className="bg-teal-500/15 text-teal-500 dark:text-teal-400 px-1.5 py-0.5 rounded-full font-medium">TTS</span>}
              {serverStatus.hasTranscribe && <span className="bg-orange-500/15 text-orange-500 dark:text-orange-400 px-1.5 py-0.5 rounded-full font-medium">STT</span>}
              {serverStatus.hasEmbeddings && <span className="bg-pink-500/15 text-pink-500 dark:text-pink-400 px-1.5 py-0.5 rounded-full font-medium">Embed</span>}
              {serverStatus.hasWebSearch  && <span className="bg-amber-500/15 text-amber-500 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">Search</span>}
            </span>
          </span>
        )}

        {!serverStatus.online && (
          <span className="text-muted-foreground ml-1">
            Start KoboldCpp, LM Studio, or Ollama to enable generation.
          </span>
        )}
      </div>
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={jsonImportRef}
        className="hidden"
        accept=".json,application/json"
        onChange={handleImportJson}
      />
      <input
        type="file"
        ref={pngImportRef}
        className="hidden"
        accept=".png,image/png"
        onChange={handleImportPng}
      />
      <input
        type="file"
        ref={avatarInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleAvatarChange}
      />

      {view === 'lorebook' ? (
        <LorebookView
          card={card}
          setCard={setCard}
          nsfwMode={nsfwMode}
          onBack={() => setView('character')}
        />
      ) : (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-6"
      >
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Left column                                                      */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-2 border-primary/10 bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-2xl font-bold tracking-tight font-heading">
                  Character Identity
                </CardTitle>
                <CardDescription className="font-sans">
                  Basic information and personality traits.
                </CardDescription>
              </div>

              {/* Controls: Mode Switch + Import/Export */}
              <div className="flex gap-2">

                {/* Undo / Redo */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={undo}
                  disabled={!canUndo}
                  title="Undo (Ctrl+Z)"
                  className="text-muted-foreground"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={redo}
                  disabled={!canRedo}
                  title="Redo (Ctrl+Y)"
                  className="text-muted-foreground"
                >
                  <Redo2 className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView('lorebook')}
                  className="bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  Open Lorebook
                  {card.character_book?.entries.length ? (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/20 text-[10px] font-bold leading-none">
                      {card.character_book.entries.length}
                    </span>
                  ) : null}
                </Button>

                {/* ── New Card dialog ─────────────────────────────────── */}
                <Dialog open={newCardOpen} onOpenChange={setNewCardOpen}>
                  <DialogTrigger
                    render={
                      <Button variant="ghost" size="sm" className="text-muted-foreground" />
                    }
                  >
                    <FilePlus className="mr-2 h-4 w-4" />
                    New
                  </DialogTrigger>

                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>Start a New Card?</DialogTitle>
                      <DialogDescription>
                        This will clear all fields and reset to a blank card.
                        Any unsaved work will be lost.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="sm:flex-row gap-2">
                      <Button variant="destructive" className="sm:flex-1" onClick={handleNewCard}>
                        Clear &amp; Start Fresh
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* ── Import dialog ───────────────────────────────────── */}
                <Dialog open={importOpen} onOpenChange={setImportOpen}>
                  <DialogTrigger
                    render={
                      <Button variant="outline" size="sm" className="border-dashed" />
                    }
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Import
                  </DialogTrigger>

                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Import Character Card</DialogTitle>
                      <DialogDescription>
                        Choose a format. Your current card will be replaced.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-2 gap-3 py-2">
                      <FormatButton
                        icon={<FileJson className="h-10 w-10" />}
                        label="JSON"
                        sublabel=".json character file"
                        onClick={() => jsonImportRef.current?.click()}
                      />
                      <FormatButton
                        icon={<FileImage className="h-10 w-10" />}
                        label="PNG Card"
                        sublabel="SillyTavern / KoboldLite"
                        onClick={() => pngImportRef.current?.click()}
                      />
                    </div>

                    <DialogFooter showCloseButton />
                  </DialogContent>
                </Dialog>

                {/* ── Export dialog ───────────────────────────────────── */}
                <Dialog open={exportOpen} onOpenChange={setExportOpen}>
                  <DialogTrigger
                    render={
                      <Button
                        variant="default"
                        size="sm"
                        className="shadow-lg shadow-primary/20"
                      />
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </DialogTrigger>

                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        Export Character Card
                        {nsfwMode && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            NSFW
                          </span>
                        )}
                      </DialogTitle>
                      <DialogDescription>
                        Exports in CCv3 format. PNG cards embed both a CCv3 and
                        legacy V2 chunk for maximum compatibility.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-2 gap-3 py-2">
                      <FormatButton
                        icon={<FileJson className="h-10 w-10" />}
                        label="JSON (CCv3)"
                        sublabel="chara_card_v3 envelope"
                        onClick={handleExportJson}
                      />
                      <FormatButton
                        icon={
                          isExporting
                            ? <RefreshCw className="h-10 w-10 animate-spin" />
                            : <FileImage className="h-10 w-10" />
                        }
                        label="PNG Card"
                        sublabel={
                          card.avatar
                            ? "Your portrait + data"
                            : "Auto-generated portrait"
                        }
                        onClick={handleExportPng}
                        disabled={isExporting}
                      />
                    </div>

                    <DialogFooter showCloseButton />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="Character Name"
                    value={card.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    className="bg-background/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nickname">
                    Nickname
                    <span className="ml-1.5 text-[10px] font-normal text-primary/60 bg-primary/10 px-1.5 py-0.5 rounded-full">CCv3</span>
                  </Label>
                  <Input
                    id="nickname"
                    placeholder="Overrides {{char}} in prompts"
                    value={card.nickname ?? ""}
                    onChange={(e) => handleInputChange("nickname", e.target.value || undefined)}
                    className="bg-background/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="creator">Creator</Label>
                  <Input
                    id="creator"
                    placeholder="Your Name"
                    value={card.creator}
                    onChange={(e) => handleInputChange("creator", e.target.value)}
                    className="bg-background/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="character_version">Version</Label>
                  <Input
                    id="character_version"
                    placeholder="1.0.0"
                    value={card.character_version}
                    onChange={(e) => handleInputChange("character_version", e.target.value)}
                    className="bg-background/50"
                  />
                </div>
              </div>

              {/* ── Physical Appearance ─────────────────────────────── */}
              <div className="space-y-3">
                <div>
                  <Label className="text-base font-semibold">Physical Appearance</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Each field is composed into the exported <code className="text-[10px] bg-muted px-1 py-0.5 rounded">description</code> automatically.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="app-gender" className="text-xs">Gender <RegenButton fieldKey="appearance_gender" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_gender")} /></Label>
                    <Input
                      id="app-gender"
                      placeholder="e.g. female, non-binary, male"
                      value={getAppearance().gender}
                      onChange={(e) => handleAppearanceChange("gender", e.target.value)}
                      className="bg-background/50 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="app-age" className="text-xs">Age <RegenButton fieldKey="appearance_age" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_age")} /></Label>
                    <Input
                      id="app-age"
                      placeholder="e.g. late 20s, looks older"
                      value={getAppearance().age}
                      onChange={(e) => handleAppearanceChange("age", e.target.value)}
                      className="bg-background/50 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="app-build" className="text-xs">Build &amp; Height <RegenButton fieldKey="appearance_build" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_build")} /></Label>
                  <Input
                    id="app-build"
                    placeholder="e.g. 6ft 2in, broad-shouldered"
                    value={getAppearance().build}
                    onChange={(e) => handleAppearanceChange("build", e.target.value)}
                    className="bg-background/50 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="app-face" className="text-xs">Face <RegenButton fieldKey="appearance_face" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_face")} /></Label>
                  <Input
                    id="app-face"
                    placeholder="e.g. strong jaw, high cheekbones, sharp nose"
                    value={getAppearance().face}
                    onChange={(e) => handleAppearanceChange("face", e.target.value)}
                    className="bg-background/50 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="app-hair" className="text-xs">Hair <RegenButton fieldKey="appearance_hair" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_hair")} /></Label>
                    <Input
                      id="app-hair"
                      placeholder="e.g. long silver, braided"
                      value={getAppearance().hair}
                      onChange={(e) => handleAppearanceChange("hair", e.target.value)}
                      className="bg-background/50 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="app-eyes" className="text-xs">Eyes <RegenButton fieldKey="appearance_eyes" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_eyes")} /></Label>
                    <Input
                      id="app-eyes"
                      placeholder="e.g. pale amber, slightly slanted"
                      value={getAppearance().eyes}
                      onChange={(e) => handleAppearanceChange("eyes", e.target.value)}
                      className="bg-background/50 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="app-skin" className="text-xs">Skin <RegenButton fieldKey="appearance_skin" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_skin")} /></Label>
                  <Input
                    id="app-skin"
                    placeholder="e.g. tanned olive, weathered from years outdoors"
                    value={getAppearance().skin}
                    onChange={(e) => handleAppearanceChange("skin", e.target.value)}
                    className="bg-background/50 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="app-marks" className="text-xs">Distinguishing Marks <RegenButton fieldKey="appearance_distinguishing_marks" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_distinguishing_marks")} /></Label>
                  <Input
                    id="app-marks"
                    placeholder="e.g. scar across left cheek, wolf tattoo on forearm"
                    value={getAppearance().distinguishing_marks}
                    onChange={(e) => handleAppearanceChange("distinguishing_marks", e.target.value)}
                    className="bg-background/50 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="app-clothing" className="text-xs">Clothing &amp; Style <RegenButton fieldKey="appearance_clothing_style" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_clothing_style")} /></Label>
                  <Input
                    id="app-clothing"
                    placeholder="e.g. worn leather duster, always carries a flask"
                    value={getAppearance().clothing_style}
                    onChange={(e) => handleAppearanceChange("clothing_style", e.target.value)}
                    className="bg-background/50 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="app-voice" className="text-xs">Voice <RegenButton fieldKey="appearance_voice" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_voice")} /></Label>
                  <Input
                    id="app-voice"
                    placeholder="e.g. deep gravelly baritone, northern accent"
                    value={getAppearance().voice}
                    onChange={(e) => handleAppearanceChange("voice", e.target.value)}
                    className="bg-background/50 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="app-backstory" className="text-xs">Backstory &amp; History <RegenButton fieldKey="appearance_backstory" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("appearance_backstory")} /></Label>
                  <Textarea
                    id="app-backstory"
                    placeholder="Background, formative events, history, lore..."
                    value={getAppearance().backstory}
                    onChange={(e) => handleAppearanceChange("backstory", e.target.value)}
                    className="min-h-[120px] bg-background/50 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="personality">Personality <RegenButton fieldKey="personality" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("personality")} /></Label>
                  {tokenCounts["personality"] !== undefined && (
                    <TokenBadge count={tokenCounts["personality"]} />
                  )}
                </div>
                <Textarea
                  id="personality"
                  placeholder="Traits, quirks, behavior..."
                  value={card.personality}
                  onChange={(e) => {
                    handleInputChange("personality", e.target.value);
                    handleTokenCount("personality", e.target.value);
                  }}
                  className="min-h-[100px] bg-background/50"
                />
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="dialogue" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-muted/50">
              <TabsTrigger value="dialogue">Dialogue</TabsTrigger>
              <TabsTrigger value="scenario">Scenario & Prompt</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
            
            {/* Dialogue tab */}
            <TabsContent value="dialogue" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Dialogue Settings</CardTitle>
                  <CardDescription>
                    How the character speaks and starts conversations.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="first_mes">First Message <RegenButton fieldKey="first_mes" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("first_mes")} /></Label>
                      {tokenCounts["first_mes"] !== undefined && (
                        <TokenBadge count={tokenCounts["first_mes"]} />
                      )}
                    </div>
                    <Textarea
                      id="first_mes"
                      placeholder="The very first thing the character says..."
                      value={card.first_mes}
                      onChange={(e) => {
                        handleInputChange("first_mes", e.target.value);
                        handleTokenCount("first_mes", e.target.value);
                      }}
                      className="min-h-[100px] bg-background/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="mes_example">Message Examples <RegenButton fieldKey="mes_example" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("mes_example")} /></Label>
                      {tokenCounts["mes_example"] !== undefined && (
                        <TokenBadge count={tokenCounts["mes_example"]} />
                      )}
                    </div>
                    <Textarea
                      id="mes_example"
                      placeholder={"<START>\n{{user}}: Hello!\n{{char}}: Hi there!"}
                      value={card.mes_example}
                      onChange={(e) => {
                        handleInputChange("mes_example", e.target.value);
                        handleTokenCount("mes_example", e.target.value);
                      }}
                      className="min-h-[150px] font-mono text-sm bg-background/50"
                    />
                  </div>

                  {/* Alternate greetings */}
                  <div className="space-y-2">
                    <Label>Alternate Greetings</Label>
                    <div className="space-y-2">
                      {card.alternate_greetings.map((greeting, i) => (
                        <div key={i} className="flex gap-2">
                          <Textarea
                            value={greeting}
                            onChange={(e) =>
                              handleArrayChange("alternate_greetings", i, e.target.value)
                            }
                            placeholder={`Alternate greeting ${i + 1}`}
                            className="min-h-[80px] bg-background/50 text-sm"
                          />
                          <div className="shrink-0 self-start mt-1 flex flex-col gap-1">
                            <RegenButton
                              fieldKey={`first_mes[${i}]`}
                              reGeneratingField={reGeneratingField}
                              isGenerating={isGenerating}
                              onClick={() => void handleRegenField("first_mes", i)}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeArrayItem("alternate_greetings", i)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addArrayItem("alternate_greetings")}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Greeting
                      </Button>
                    </div>
                  </div>

                  {/* Group-only greetings */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      Group-Only Greetings
                      <span className="text-[10px] font-normal text-primary/60 bg-primary/10 px-1.5 py-0.5 rounded-full">CCv3</span>
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Used only when this character appears in a group chat.
                    </p>
                    <div className="space-y-2">
                      {card.group_only_greetings.map((greeting, i) => (
                        <div key={i} className="flex gap-2">
                          <Textarea
                            value={greeting}
                            onChange={(e) =>
                              handleArrayChange("group_only_greetings", i, e.target.value)
                            }
                            placeholder={`Group greeting ${i + 1}`}
                            className="min-h-[80px] bg-background/50 text-sm"
                          />
                          <div className="shrink-0 self-start mt-1 flex flex-col gap-1">
                            <RegenButton
                              fieldKey={`scenario[${i}]`}
                              reGeneratingField={reGeneratingField}
                              isGenerating={isGenerating}
                              onClick={() => void handleRegenField("scenario", i)}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeArrayItem("group_only_greetings", i)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addArrayItem("group_only_greetings")}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Group Greeting
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Scenario tab */}
            <TabsContent value="scenario" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Context & Prompts</CardTitle>
                  <CardDescription>
                    Setting the scene and guiding the AI's behavior.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="scenario">Scenario <RegenButton fieldKey="scenario" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("scenario")} /></Label>
                      {tokenCounts["scenario"] !== undefined && (
                        <TokenBadge count={tokenCounts["scenario"]} />
                      )}
                    </div>
                    <Textarea
                      id="scenario"
                      placeholder="Current situation, location, time..."
                      value={card.scenario}
                      onChange={(e) => {
                        handleInputChange("scenario", e.target.value);
                        handleTokenCount("scenario", e.target.value);
                      }}
                      className="min-h-[100px] bg-background/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="system_prompt">System Prompt <RegenButton fieldKey="system_prompt" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("system_prompt")} /></Label>
                    <Textarea
                      id="system_prompt"
                      placeholder="Override default system instructions..."
                      value={card.system_prompt}
                      onChange={(e) =>
                        handleInputChange("system_prompt", e.target.value)
                      }
                      className="min-h-[100px] font-mono text-sm bg-background/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="post_history_instructions">
                      Post-History Instructions <RegenButton fieldKey="post_history_instructions" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("post_history_instructions")} />
                    </Label>
                    <Textarea
                      id="post_history_instructions"
                      placeholder="Instructions injected after the chat history..."
                      value={card.post_history_instructions}
                      onChange={(e) =>
                        handleInputChange("post_history_instructions", e.target.value)
                      }
                      className="min-h-[80px] font-mono text-sm bg-background/50"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>



            {/* Advanced tab */}
            <TabsContent value="advanced" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Metadata & Notes</CardTitle>
                  <CardDescription>
                    Tags, creator notes, and CCv3 fields.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <div className="flex flex-wrap gap-2">
                      {card.tags.map((tag, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1 bg-muted px-2 py-1 rounded-md"
                        >
                          <Input
                            value={tag}
                            onChange={(e) =>
                              handleArrayChange("tags", i, e.target.value)
                            }
                            className="h-7 w-24 border-none bg-transparent p-0 text-xs focus-visible:ring-0"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4"
                            onClick={() => removeArrayItem("tags", i)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => addArrayItem("tags")}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Tag
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="creator_notes">Creator Notes <RegenButton fieldKey="creator_notes" reGeneratingField={reGeneratingField} isGenerating={isGenerating} onClick={() => void handleRegenField("creator_notes")} /></Label>
                    <Textarea
                      id="creator_notes"
                      placeholder="Notes for other users of this card..."
                      value={card.creator_notes}
                      onChange={(e) =>
                        handleInputChange("creator_notes", e.target.value)
                      }
                      className="min-h-[80px] bg-background/50"
                    />
                  </div>

                  {/* CCv3: Source URLs (append-only, read-only per spec) */}
                  {card.source && card.source.length > 0 && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <Link className="h-3 w-3" />
                        Source URLs
                        <span className="text-[10px] font-normal text-primary/60 bg-primary/10 px-1.5 py-0.5 rounded-full">CCv3 — read only</span>
                      </Label>
                      <div className="space-y-1">
                        {card.source.map((src, i) => (
                          <a
                            key={i}
                            href={src.startsWith("http") ? src : undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline truncate"
                          >
                            <Link className="h-3 w-3 shrink-0" />
                            {src}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CCv3: Timestamps (read-only) */}
                  {(card.creation_date || card.modification_date) && (
                    <div className="space-y-1 text-xs text-muted-foreground border rounded-lg px-3 py-2">
                      {card.creation_date && (
                        <p>Created: {new Date(card.creation_date * 1000).toLocaleString()}</p>
                      )}
                      {card.modification_date && (
                        <p>Last modified: {new Date(card.modification_date * 1000).toLocaleString()}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* Right column — AI generator + card preview                       */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-6">

          {/* AI Architect */}
          <Card className="border-2 border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Architect
              </CardTitle>
              <CardDescription>
                Generate a character using your local AI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Genre</Label>
                <Input
                  value={genParams.genre}
                  onChange={(e) =>
                    setGenParams((p) => ({ ...p, genre: e.target.value }))
                  }
                  placeholder="e.g. Cyberpunk, High Fantasy"
                />
              </div>
              <div className="space-y-2">
                <Label>Archetype</Label>
                <Input
                  value={genParams.archetype}
                  onChange={(e) =>
                    setGenParams((p) => ({ ...p, archetype: e.target.value }))
                  }
                  placeholder="e.g. Grumpy Detective, Elven Archer"
                />
              </div>
              <div className="space-y-2">
                <Label>Additional Context</Label>
                <Textarea
                  value={genParams.additionalInfo}
                  onChange={(e) =>
                    setGenParams((p) => ({ ...p, additionalInfo: e.target.value }))
                  }
                  placeholder="Any specific details..."
                  className="h-20"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              {/* ── Token Budget Bar ────────────────────────────── */}
              {serverStatus.online && serverStatus.maxContextLength && Object.keys(tokenCounts).length > 0 && (() => {
                const total = Object.values(tokenCounts).reduce((a, b) => a + b, 0);
                if (!total) return null;
                const pct = Math.min(100, Math.round((total / serverStatus.maxContextLength) * 100));
                const colour = pct > 80 ? "bg-rose-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <div className="w-full space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Context budget</span>
                      <span className="tabular-nums font-mono">
                        {total.toLocaleString()} / {serverStatus.maxContextLength.toLocaleString()} tok
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", colour)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-2 w-full">
                <Button
                  className="flex-1"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      {streamTokenCount > 0 ? (
                        <span className="tabular-nums">{streamTokenCount} tokens…</span>
                      ) : (
                        "Starting…"
                      )}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Character
                    </>
                  )}
                </Button>
                {isGenerating && (
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={handleAbort}
                    title="Cancel generation"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* ── Generation error panel ──────────────────────── */}
              {genError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-destructive">Generation failed</p>
                    <div className="flex items-center gap-2 shrink-0">
                      {genRawOutput && (
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(genRawOutput);
                            setRawCopied(true);
                            setTimeout(() => setRawCopied(false), 2000);
                          }}
                          className="flex items-center gap-1 text-[10px] text-destructive/60 hover:text-destructive transition-colors"
                          title="Copy raw AI output to clipboard for debugging"
                        >
                          {rawCopied
                            ? <><Check className="h-3 w-3 text-green-500" /><span className="text-green-500">Copied!</span></>
                            : <><Copy className="h-3 w-3" />Copy Raw</>}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setGenError(null); setGenRawOutput(null); }}
                        className="text-destructive/60 hover:text-destructive"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <pre className="text-[11px] text-destructive/80 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                    {genError}
                  </pre>
                </div>
              )}

              {/* ── Generation options ──────────────────────────── */}
              <div className="space-y-2 rounded-lg border border-border/60 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Generation Options
                </p>

                {/* Alternate greetings toggle */}
                <button
                  type="button"
                  onClick={() => setIncludeAlternates((v) => !v)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    includeAlternates
                      ? "border-primary/40 bg-primary/5 text-primary"
                      : "border-dashed border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  <span>Alternate Greetings <span className="font-normal opacity-60">(+~800 tokens)</span></span>
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                    includeAlternates ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    {includeAlternates ? "ON" : "OFF"}
                  </span>
                </button>

                {/* Group greetings toggle */}
                <button
                  type="button"
                  onClick={() => setIncludeGroupGreetings((v) => !v)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    includeGroupGreetings
                      ? "border-primary/40 bg-primary/5 text-primary"
                      : "border-dashed border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  <span>Group Greetings <span className="font-normal opacity-60">(+~200 tokens)</span></span>
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                    includeGroupGreetings ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    {includeGroupGreetings ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              {/* NSFW Mode toggle */}
              <button
                type="button"
                onClick={() => setNsfwMode((v) => {
                  const next = !v;
                  try { localStorage.setItem("kca-nsfw", String(next)); } catch { /* ignore */ }
                  return next;
                })}
                className={cn(
                  "w-full flex items-center justify-between rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors",
                  nsfwMode
                    ? "border-rose-500/60 bg-rose-500/10 text-rose-500"
                    : "border-dashed border-border text-muted-foreground hover:border-rose-400/50 hover:text-rose-400"
                )}
              >
                <span className="flex items-center gap-2">
                  <FlameKindling className="h-4 w-4" />
                  NSFW Mode <span className="font-normal opacity-60 text-xs">(+~500 tokens)</span>
                </span>
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  nsfwMode
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-muted text-muted-foreground"
                )}>
                  {nsfwMode ? "ON" : "OFF"}
                </span>
              </button>

              {nsfwMode && (
                <p className="text-[11px] text-rose-400/80 leading-relaxed text-center">
                  Explicit adult content will be generated. For use by consenting adults only.
                </p>
              )}
            </CardFooter>
          </Card>

          {/* Card Preview */}
          <Card className="bg-muted/30 border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Info className="h-4 w-4" />
                Card Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Portrait area */}
              <div className="aspect-[3/4] rounded-lg bg-gradient-to-br from-primary/20 to-secondary/20 border shadow-inner relative overflow-hidden">

                {card.avatar ? (
                  /* Real portrait */
                  <>
                    <img
                      src={card.avatar}
                      alt={card.name || "Character portrait"}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    {/* Gradient scrim for text legibility */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

                    {/* Name / genre overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                      <h3 className="text-lg font-bold truncate leading-tight">
                        {card.name || "Unnamed Character"}
                      </h3>
                      {(genParams.genre || genParams.archetype) && (
                        <p className="text-xs opacity-60 uppercase tracking-widest mt-1">
                          {[genParams.genre, genParams.archetype]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      )}
                      {card.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {card.tags.slice(0, 3).map((tag, i) => {
                            const isNsfwTag = ["nsfw", "explicit", "adult content"].includes(tag.toLowerCase());
                            return (
                              <span
                                key={i}
                                className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded-full backdrop-blur-sm",
                                  isNsfwTag
                                    ? "bg-rose-500/40 text-rose-100 font-semibold"
                                    : "bg-white/15"
                                )}
                              >
                                {tag}
                              </span>
                            );
                          })}
                          {card.tags.length > 3 && (
                            <span className="text-[10px] opacity-50">
                              +{card.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Remove portrait button */}
                    <button
                      type="button"
                      onClick={clearAvatar}
                      title="Remove portrait"
                      className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  /* Placeholder */
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <div className="absolute inset-0 bg-grid-white/10 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.5))] -z-10" />

                    <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
                      <span className="text-3xl font-bold text-primary/40">
                        {card.name ? card.name[0].toUpperCase() : "?"}
                      </span>
                    </div>

                    <div className="space-y-1 w-full">
                      <h3 className="text-xl font-bold truncate">
                        {card.name || "Unnamed Character"}
                      </h3>
                      <p className="text-xs text-muted-foreground uppercase tracking-widest">
                        {[genParams.genre, genParams.archetype]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    </div>

                    <p className="text-xs text-left line-clamp-4 italic opacity-60 w-full">
                      {card.description || "No description provided yet..."}
                    </p>

                    {card.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-center">
                        {card.tags.slice(0, 4).map((tag, i) => {
                          const isNsfwTag = ["nsfw", "explicit", "adult content"].includes(tag.toLowerCase());
                          return (
                            <span
                              key={i}
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full border",
                                isNsfwTag
                                  ? "bg-rose-500/15 border-rose-500/30 text-rose-500 dark:text-rose-400 font-semibold"
                                  : "bg-primary/10 border-primary/20 text-primary/70"
                              )}
                            >
                              {tag}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Portrait upload / change button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-3 border-dashed"
                onClick={() => avatarInputRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                {card.avatar ? "Change Portrait" : "Upload Portrait"}
              </Button>

              {/* ── Image Generation Prompt ──────────────────────────── */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Image Generation Prompt
                  </Label>
                  {imagePrompt && (
                    <button
                      type="button"
                      onClick={handleCopyPrompt}
                      title="Copy to clipboard"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {promptCopied
                        ? <><Check className="h-3 w-3 text-green-500" /><span className="text-green-500">Copied!</span></>
                        : <><Copy className="h-3 w-3" />Copy</>
                      }
                    </button>
                  )}
                </div>

                <Textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder={"Click \"Generate Prompt\" to build a Stable Diffusion prompt from the card\u2019s appearance, personality, and scenario..."}
                  className="min-h-[110px] text-xs bg-background/50 font-mono resize-none"
                />

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                  onClick={handleGenerateImagePrompt}
                  disabled={isGeneratingPrompt || isGeneratingPortrait}
                >
                  {isGeneratingPrompt ? (
                    <>
                      <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Generating Prompt...
                    </>
                  ) : (
                    <>
                      <Wand2 className="mr-2 h-3.5 w-3.5" />
                      Generate Image Prompt
                    </>
                  )}
                </Button>

                {/* Generate Portrait — only active when SD model is loaded */}
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "w-full border-dashed transition-colors",
                    serverStatus.hasTxt2Img && imagePrompt
                      ? "border-violet-500/50 text-violet-500 hover:border-violet-500 hover:bg-violet-500/5 dark:text-violet-400 dark:border-violet-400/50 dark:hover:border-violet-400"
                      : ""
                  )}
                  onClick={handleGeneratePortrait}
                  disabled={isGeneratingPortrait || isGeneratingPrompt || !imagePrompt || !serverStatus.hasTxt2Img}
                  title={
                    !serverStatus.online
                      ? "KoboldCpp is offline"
                      : !serverStatus.hasTxt2Img
                      ? "Requires a Stable Diffusion model loaded in KoboldCpp"
                      : !imagePrompt
                      ? "Generate an image prompt first"
                      : "Generate portrait from the prompt above"
                  }
                >
                  {isGeneratingPortrait ? (
                    <>
                      <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Painting Portrait...
                    </>
                  ) : (
                    <>
                      <ImagePlus className="mr-2 h-3.5 w-3.5" />
                      Generate Portrait
                    </>
                  )}
                </Button>

                {/* Hint when SD model isn't loaded */}
                {serverStatus.online && !serverStatus.hasTxt2Img && (
                  <p className="text-[10px] text-center text-muted-foreground leading-relaxed">
                    Load a Stable Diffusion model in KoboldCpp to enable portrait generation.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
      )}
    </div>
  );
}
