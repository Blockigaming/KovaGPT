import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditSink, RuntimeSession } from "./types";

export class MemoryAuditSink implements AuditSink {
  readonly #events: AuditEvent[] = [];

  async append(event: Readonly<AuditEvent>) {
    this.#events.push(Object.freeze({ ...event, details: Object.freeze({ ...event.details }) }));
  }

  async list(sessionId: string) {
    return this.#events
      .filter((event) => event.sessionId === sessionId)
      .map((event) => ({ ...event }));
  }
}

export async function audit(
  sink: AuditSink,
  session: RuntimeSession,
  action: string,
  outcome: AuditEvent["outcome"],
  details: AuditEvent["details"] = {},
) {
  // Audit metadata is deliberately allow-listed by callers; page content, query strings,
  // cookies, headers, and credentials never belong in this channel.
  await sink.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: session.descriptor.id,
    ownerId: session.descriptor.ownerId,
    workspaceId: session.descriptor.workspaceId,
    action,
    outcome,
    details,
  });
}
