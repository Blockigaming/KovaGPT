export type PlatformDomain =
  | "projects"
  | "memory"
  | "library"
  | "research"
  | "files"
  | "images"
  | "artifacts"
  | "prompts"
  | "knowledge"
  | "work"
  | "automation"
  | "apps"
  | "context"
  | "intelligence"
  | "platform";
export type PlatformEvent<T = unknown> = Readonly<{
  id: string;
  domain: PlatformDomain;
  name: string;
  occurredAt: string;
  payload: T;
}>;
type Listener = (event: PlatformEvent) => void;

class PlatformEventBus {
  private listeners = new Set<Listener>();
  private history: PlatformEvent[] = [];

  publish<T>(domain: PlatformDomain, name: string, payload: T): PlatformEvent<T> {
    const event = Object.freeze({
      id: crypto.randomUUID(),
      domain,
      name,
      occurredAt: new Date().toISOString(),
      payload,
    });
    this.history = [...this.history.slice(-199), event];
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        if (import.meta.env.DEV) console.error("[platform-event-listener]", error);
      }
    }
    return event;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot() {
    return [...this.history];
  }
}

export const platformEvents = new PlatformEventBus();
