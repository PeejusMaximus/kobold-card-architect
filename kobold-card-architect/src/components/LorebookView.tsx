import * as React from "react";
import { motion } from "motion/react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  Trash2,
  ArrowLeft,
  Sparkles,
  RefreshCw,
  X,
  Square
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CharacterCard,
  CharacterBook,
  CharacterBookEntry,
  DEFAULT_LOREBOOK_ENTRY,
} from "@/src/types";
import { exportLorebookAsJson } from "@/src/lib/cardio";
import { generateLorebook } from "@/src/lib/ai";
import { abortGeneration } from "@/src/lib/kobold";

interface LorebookViewProps {
  card: CharacterCard;
  setCard: React.Dispatch<React.SetStateAction<CharacterCard>>;
  nsfwMode: boolean;
  onBack: () => void;
}

const CATEGORIES = ["People", "Places", "Events", "Items", "Concepts"];

export function LorebookView({ card, setCard, nsfwMode, onBack }: LorebookViewProps) {
  const [expandedEntries, setExpandedEntries] = React.useState<Set<number>>(new Set());

  // AI Lorebook Generator state
  const [isGeneratingLorebook, setIsGeneratingLorebook] = React.useState(false);
  const [lorebookGenError, setLorebookGenError] = React.useState<string | null>(null);
  const [lorebookEntryCount, setLorebookEntryCount] = React.useState(5);
  const [lorebookCategories, setLorebookCategories] = React.useState<string[]>([...CATEGORIES]);
  const lorebookAbortRef = React.useRef<AbortController | null>(null);

  const ensureBook = (prev: CharacterCard): CharacterBook =>
    prev.character_book ?? { entries: [], extensions: {} };

  const addLorebookEntry = () => {
    setCard((prev) => {
      const book = ensureBook(prev);
      const newEntry: CharacterBookEntry = {
        ...DEFAULT_LOREBOOK_ENTRY,
        id: Date.now(),
        insertion_order: book.entries.length * 10,
      };
      const newIdx = book.entries.length;
      setExpandedEntries((s) => new Set([...s, newIdx]));
      return { ...prev, character_book: { ...book, entries: [...book.entries, newEntry] } };
    });
  };

  const removeLorebookEntry = (index: number) => {
    setCard((prev) => {
      const book = ensureBook(prev);
      return {
        ...prev,
        character_book: {
          ...book,
          entries: book.entries.filter((_, i) => i !== index),
        },
      };
    });
    setExpandedEntries((s) => {
      const next = new Set<number>();
      s.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  const updateLorebookEntry = (index: number, patch: Partial<CharacterBookEntry>) => {
    setCard((prev) => {
      const book = ensureBook(prev);
      const entries = book.entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
      return { ...prev, character_book: { ...book, entries } };
    });
  };

  const toggleEntryExpanded = (index: number) => {
    setExpandedEntries((s) => {
      const next = new Set(s);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const toggleCategory = (cat: string) => {
    setLorebookCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleGenerateLorebook = async () => {
    const controller = new AbortController();
    lorebookAbortRef.current = controller;
    setIsGeneratingLorebook(true);
    setLorebookGenError(null);
    try {
      const newEntries = await generateLorebook({
        card,
        entryCount: lorebookEntryCount,
        categories: lorebookCategories,
        nsfw: nsfwMode,
        signal: controller.signal,
      });
      setCard((prev) => {
        const book = ensureBook(prev);
        const startOrder = book.entries.length * 10;
        const startIdx = book.entries.length;
        const merged = [
          ...book.entries,
          ...newEntries.map((e, i) => ({
            ...DEFAULT_LOREBOOK_ENTRY,
            ...e,
            id: Date.now() + i,
            insertion_order: startOrder + i * 10,
          })),
        ];
        // Auto-expand newly added entries
        setExpandedEntries((s) => {
          const next = new Set(s);
          for (let i = startIdx; i < merged.length; i++) next.add(i);
          return next;
        });
        return { ...prev, character_book: { ...book, entries: merged } };
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Lorebook generation failed.";
      setLorebookGenError(msg);
    } finally {
      setIsGeneratingLorebook(false);
      lorebookAbortRef.current = null;
    }
  };

  const handleAbortLorebook = async () => {
    lorebookAbortRef.current?.abort();
    await abortGeneration();
    setIsGeneratingLorebook(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Character
        </Button>
        <div>
          <h2 className="text-2xl font-bold font-heading flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Lorebook Editor
            <span className="text-[10px] font-normal text-primary/60 bg-primary/10 px-2 py-1 rounded-full uppercase tracking-wider">
              {card.name || "Unnamed Character"}
            </span>
          </h2>
          <p className="text-muted-foreground text-sm">
            Keyword-triggered context entries injected into the AI's prompt during chat.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => card.character_book && exportLorebookAsJson(card.character_book, card.name)}
            disabled={!card.character_book || card.character_book.entries.length === 0}
            title="Export lorebook as a standalone KoboldLite world info JSON file"
          >
            <Download className="h-4 w-4 mr-2" /> Export Worldinfo
          </Button>
          <Button onClick={addLorebookEntry} className="shadow-lg shadow-primary/20">
            <Plus className="h-4 w-4 mr-2" /> Add Entry
          </Button>
        </div>
      </div>

      <Card className="border-2 border-primary/10 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Lorebook Generator
          </CardTitle>
          <CardDescription>
            Automatically generate lorebook entries based on the character's backstory, personality, and scenario.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label>Entries to Generate</Label>
              <div className="flex flex-wrap gap-2">
                {[3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <Button
                    key={num}
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-10 px-0",
                      lorebookEntryCount === num && "border-primary/40 bg-primary/5 text-primary"
                    )}
                    onClick={() => setLorebookEntryCount(num)}
                  >
                    {num}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Categories</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => {
                  const isActive = lorebookCategories.includes(cat);
                  return (
                    <Button
                      key={cat}
                      variant="outline"
                      size="sm"
                      onClick={() => toggleCategory(cat)}
                      className={cn(
                        isActive && nsfwMode
                          ? "border-rose-500/40 bg-rose-500/5 text-rose-500"
                          : isActive
                          ? "border-primary/40 bg-primary/5 text-primary"
                          : "border-dashed border-border text-muted-foreground"
                      )}
                    >
                      {cat}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              className="flex-1 max-w-sm"
              disabled={!card.name || lorebookCategories.length === 0 || isGeneratingLorebook}
              onClick={handleGenerateLorebook}
            >
              {isGeneratingLorebook ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Generating Lore...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Lorebook
                </>
              )}
            </Button>

            {isGeneratingLorebook && (
              <Button
                variant="destructive"
                size="icon"
                onClick={handleAbortLorebook}
                title="Stop generation"
              >
                <Square className="h-4 w-4" />
              </Button>
            )}
          </div>

          {lorebookGenError && (
            <div className="flex items-start justify-between gap-2 mt-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              <p>{lorebookGenError}</p>
              <button
                type="button"
                onClick={() => setLorebookGenError(null)}
                className="text-destructive/70 hover:text-destructive shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {(!card.character_book || card.character_book.entries.length === 0) && !isGeneratingLorebook && (
          <div className="p-12 text-center border-2 border-dashed rounded-xl bg-muted/20 text-muted-foreground">
            <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <h3 className="text-lg font-medium mb-1">Your Lorebook is Empty</h3>
            <p className="text-sm opacity-70">
              Add entries manually or use the AI generator above to populate the world.
            </p>
          </div>
        )}

        {card.character_book?.entries.map((entry, i) => {
          const isExpanded = expandedEntries.has(i);
          const displayName = entry.name || (entry.keys.length > 0 ? entry.keys.join(", ") : `Entry ${i + 1}`);
          return (
            <div key={entry.id || i} className="border rounded-xl bg-card shadow-sm overflow-hidden transition-all">
              {/* Entry header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                <Switch
                  checked={entry.enabled}
                  onCheckedChange={(v) => updateLorebookEntry(i, { enabled: v })}
                />
                <span className="flex-1 font-medium truncate">
                  {displayName}
                </span>
                {entry.constant && (
                  <span className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                    Always On
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => toggleEntryExpanded(i)}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeLorebookEntry(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Entry body (collapsible) */}
              {isExpanded && (
                <div className="p-4 space-y-4 border-t bg-card/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Display Name</Label>
                      <Input
                        value={entry.name ?? ""}
                        onChange={(e) => updateLorebookEntry(i, { name: e.target.value })}
                        placeholder="Optional label"
                        className="bg-background/50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Insertion Order</Label>
                      <Input
                        type="number"
                        value={entry.insertion_order}
                        onChange={(e) => updateLorebookEntry(i, { insertion_order: Number(e.target.value) })}
                        className="bg-background/50"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Trigger Keywords <span className="text-muted-foreground font-normal">(comma-separated)</span></Label>
                    <Input
                      value={entry.keys.join(", ")}
                      onChange={(e) => updateLorebookEntry(i, {
                        keys: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                      })}
                      placeholder="keyword1, keyword2"
                      className="bg-background/50 font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Content</Label>
                    <Textarea
                      value={entry.content}
                      onChange={(e) => updateLorebookEntry(i, { content: e.target.value })}
                      placeholder="Text injected into the prompt when triggered..."
                      className="min-h-[120px] bg-background/50 text-sm leading-relaxed"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Position</Label>
                      <Select
                        value={entry.position ?? "before_char"}
                        onValueChange={(v) => updateLorebookEntry(i, { position: v as "before_char" | "after_char" })}
                      >
                        <SelectTrigger className="bg-background/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="before_char">Before character defs</SelectItem>
                          <SelectItem value="after_char">After character defs</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col justify-center gap-3 md:pl-4">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={entry.constant ?? false}
                          onCheckedChange={(v) => updateLorebookEntry(i, { constant: v })}
                        />
                        <Label className="text-sm cursor-pointer">Always inject (ignore keywords)</Label>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={entry.selective ?? false}
                          onCheckedChange={(v) => updateLorebookEntry(i, { selective: v })}
                        />
                        <Label className="text-sm cursor-pointer">Selective trigger</Label>
                      </div>
                    </div>
                  </div>

                  {entry.selective && (
                    <div className="space-y-1.5 pt-2 border-t mt-4 border-dashed">
                      <Label className="text-xs">Secondary Keywords <span className="text-muted-foreground font-normal">(comma-separated)</span></Label>
                      <p className="text-[10px] text-muted-foreground mb-1">
                        If selective is on, at least one primary keyword AND one secondary keyword must be present to trigger.
                      </p>
                      <Input
                        value={(entry.secondary_keys ?? []).join(", ")}
                        onChange={(e) => updateLorebookEntry(i, {
                          secondary_keys: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                        })}
                        placeholder="secondary1, secondary2"
                        className="bg-background/50 font-mono text-sm"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Skeleton placeholders during generation */}
        {isGeneratingLorebook && (
          <div className="space-y-3">
            {Array.from({ length: lorebookEntryCount }).map((_, i) => (
              <div key={`skel-${i}`} className="h-14 rounded-xl border bg-muted/30 animate-pulse flex items-center px-4">
                <div className="h-5 w-8 bg-muted rounded-full mr-3" />
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="ml-auto flex gap-2">
                  <div className="h-8 w-8 bg-muted rounded" />
                  <div className="h-8 w-8 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}