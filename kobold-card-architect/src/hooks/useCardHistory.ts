import * as React from "react";
import { CharacterCard } from "@/src/types";

const MAX_HISTORY = 30;

type CardSetter = CharacterCard | ((prev: CharacterCard) => CharacterCard);

interface CardHistory {
  card: CharacterCard;
  set: (next: CardSetter) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Ring-buffer undo/redo history for the character card.
 * Keeps the last MAX_HISTORY snapshots. All card mutations must go through
 * `set()` — direct `useState` setCard calls bypass history.
 */
export function useCardHistory(initial: CharacterCard): CardHistory {
  const [past,    setPast]    = React.useState<CharacterCard[]>([]);
  const [present, setPresent] = React.useState<CharacterCard>(initial);
  const [future,  setFuture]  = React.useState<CharacterCard[]>([]);

  const set = React.useCallback((next: CardSetter) => {
    setPresent((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      setPast((p) => {
        const updated = [...p, prev];
        return updated.length > MAX_HISTORY
          ? updated.slice(updated.length - MAX_HISTORY)
          : updated;
      });
      setFuture([]);
      return resolved;
    });
  }, []);

  const undo = React.useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev    = p[p.length - 1];
      const newPast = p.slice(0, p.length - 1);
      setFuture((f) => [present, ...f]);
      setPresent(prev);
      return newPast;
    });
  }, [present]);

  const redo = React.useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next      = f[0];
      const newFuture = f.slice(1);
      setPast((p) => {
        const updated = [...p, present];
        return updated.length > MAX_HISTORY
          ? updated.slice(updated.length - MAX_HISTORY)
          : updated;
      });
      setPresent(next);
      return newFuture;
    });
  }, [present]);

  return {
    card: present,
    set,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}