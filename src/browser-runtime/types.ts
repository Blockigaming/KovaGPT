import type { Browser, BrowserContext, BrowserType, Page } from "playwright";

export type BrowserEngine = "chromium" | "firefox" | "webkit";
export type BrowserPermission = "navigate" | "screenshot" | "dom_snapshot";

export interface SessionIdentity {
  ownerId: string;
  workspaceId: string;
  workRunId?: string;
  chatId?: string;
}

export interface PermissionPolicy {
  grants: readonly BrowserPermission[];
  allowedOrigins?: readonly string[];
  deniedOrigins?: readonly string[];
  allowPrivateNetworks?: boolean;
}

export interface CreateSessionOptions extends SessionIdentity {
  engine?: BrowserEngine;
  lifetimeMs?: number;
  idleTimeoutMs?: number;
  permissions: PermissionPolicy;
}

export interface SessionDescriptor extends SessionIdentity {
  id: string;
  engine: BrowserEngine;
  createdAt: string;
  expiresAt: string;
  idleTimeoutMs: number;
  lastUsedAt: string;
  permissions: Readonly<PermissionPolicy>;
  activeTabId?: string;
}

export interface TabDescriptor {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  history: readonly string[];
  historyIndex: number;
  active: boolean;
}

export interface DomNodeSnapshot {
  nodeId: number;
  role: string;
  name?: string;
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: DomNodeSnapshot[];
}

export interface DomSnapshot {
  url: string;
  title: string;
  capturedAt: string;
  root: DomNodeSnapshot;
}

export interface ScreenshotArtifact {
  id: string;
  sessionId: string;
  tabId: string;
  kind: "viewport" | "full-page" | "element";
  mimeType: "image/png";
  byteLength: number;
  sha256: string;
  storageKey: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  ownerId: string;
  workspaceId: string;
  action: string;
  outcome: "success" | "denied" | "failure";
  details: Record<string, string | number | boolean | null>;
}

export interface AuditSink {
  append(event: Readonly<AuditEvent>): Promise<void>;
  list(sessionId: string): Promise<readonly AuditEvent[]>;
}

export interface EngineProvider {
  get(engine: BrowserEngine): BrowserType;
}

export interface RuntimeSession {
  descriptor: SessionDescriptor;
  browser: Browser;
  context: BrowserContext;
  tabs: Map<string, { page: Page; descriptor: TabDescriptor }>;
  storagePath: string;
  closing?: Promise<void>;
}
