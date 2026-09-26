import type { FileLanguage } from "@/contracts/paths";
import type { TerminalStatus } from "./generation.reducer";

/** Editor-facing stream events. Text never goes through Vue reactivity. */
export interface GenerationBusEvents {
  "file-start": { path: string; language: FileLanguage };
  "file-delta": { path: string; text: string };
  "file-end": { path: string; status: "valid" | "rejected" };
  end: { outcome: TerminalStatus };
}

type Handler<T> = (payload: T) => void;

export interface GenerationBus {
  on<K extends keyof GenerationBusEvents>(
    type: K,
    handler: Handler<GenerationBusEvents[K]>,
  ): () => void;
  emit<K extends keyof GenerationBusEvents>(
    type: K,
    payload: GenerationBusEvents[K],
  ): void;
}

export function createGenerationBus(): GenerationBus {
  type AnyHandler = (payload: unknown) => void;
  const handlers = new Map<keyof GenerationBusEvents, Set<AnyHandler>>();
  return {
    on(type, handler) {
      const fn = handler as AnyHandler;
      const set = handlers.get(type) ?? new Set<AnyHandler>();
      handlers.set(type, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      for (const handler of handlers.get(type) ?? []) {
        try {
          handler(payload);
        } catch (error) {
          console.error("[generation-bus] handler failed", error);
        }
      }
    },
  };
}
