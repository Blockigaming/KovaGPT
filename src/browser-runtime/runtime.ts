import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { audit, MemoryAuditSink } from "./audit";
import { BrowserArtifactStore } from "./artifacts";
import { runtimeError } from "./errors";
import { authorizeNavigationRequest, requirePermission } from "./permissions";
import { BrowserSessionManager } from "./session-manager";
import type {
  AuditSink,
  CreateSessionOptions,
  DomSnapshot,
  RuntimeSession,
  ScreenshotArtifact,
  TabDescriptor,
} from "./types";

export interface BrowserRuntimeOptions {
  artifactRoot: string;
  auditSink?: AuditSink;
  sessionManager?: BrowserSessionManager;
}

export class BrowserRuntime {
  readonly artifacts: BrowserArtifactStore;
  readonly sessions: BrowserSessionManager;
  readonly auditSink: AuditSink;

  constructor(options: BrowserRuntimeOptions) {
    this.auditSink = options.auditSink ?? new MemoryAuditSink();
    this.artifacts = new BrowserArtifactStore(options.artifactRoot);
    this.sessions =
      options.sessionManager ?? new BrowserSessionManager(this.artifacts, this.auditSink);
  }

  createSession(options: CreateSessionOptions) {
    return this.sessions.create(options);
  }
  closeSession(sessionId: string, ownerId: string) {
    return this.sessions.close(sessionId, ownerId);
  }
  shutdown() {
    return this.sessions.shutdown();
  }
  auditLog(sessionId: string, ownerId: string) {
    this.sessions.get(sessionId, ownerId);
    return this.auditSink.list(sessionId);
  }

  async createTab(sessionId: string, ownerId: string, url?: string) {
    const session = this.sessions.get(sessionId, ownerId);
    const page = await session.context.newPage();
    const id = randomUUID();
    const descriptor: TabDescriptor = {
      id,
      url: page.url(),
      title: "",
      history: [],
      historyIndex: -1,
      active: true,
    };
    for (const tab of session.tabs.values()) tab.descriptor.active = false;
    session.tabs.set(id, { page, descriptor });
    session.descriptor.activeTabId = id;
    if (url) await this.openUrl(sessionId, ownerId, id, url);
    await audit(this.auditSink, session, "tab.created", "success", { tabId: id });
    return this.describeTab(session, id);
  }

  async closeTab(sessionId: string, ownerId: string, tabId: string) {
    const session = this.sessions.get(sessionId, ownerId);
    const tab = this.tab(session, tabId);
    session.tabs.delete(tabId);
    await tab.page.close();
    if (session.descriptor.activeTabId === tabId) {
      const next = session.tabs.values().next().value as { descriptor: TabDescriptor } | undefined;
      session.descriptor.activeTabId = next?.descriptor.id;
      if (next) next.descriptor.active = true;
    }
    await audit(this.auditSink, session, "tab.closed", "success", { tabId });
  }

  switchTab(sessionId: string, ownerId: string, tabId: string) {
    const session = this.sessions.get(sessionId, ownerId);
    this.tab(session, tabId);
    for (const tab of session.tabs.values()) tab.descriptor.active = tab.descriptor.id === tabId;
    session.descriptor.activeTabId = tabId;
    return this.describeTab(session, tabId);
  }

  async duplicateTab(sessionId: string, ownerId: string, tabId: string) {
    const session = this.sessions.get(sessionId, ownerId);
    return this.createTab(sessionId, ownerId, this.tab(session, tabId).page.url());
  }

  listTabs(sessionId: string, ownerId: string) {
    const session = this.sessions.get(sessionId, ownerId);
    return [...session.tabs.keys()].map((id) => this.describeTab(session, id));
  }

  async openUrl(
    sessionId: string,
    ownerId: string,
    tabId: string,
    rawUrl: string,
    timeoutMs = 30_000,
  ) {
    const session = this.sessions.get(sessionId, ownerId);
    const url = await authorizeNavigationRequest(session.descriptor.permissions, rawUrl);
    const tab = this.tab(session, tabId);
    try {
      await tab.page.goto(url.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      this.recordNavigation(tab.descriptor, tab.page.url());
      await this.refreshMetadata(tab.page, tab.descriptor);
      await audit(this.auditSink, session, "navigation.open", "success", {
        tabId,
        origin: url.origin,
      });
      return this.describeTab(session, tabId);
    } catch (error) {
      await audit(this.auditSink, session, "navigation.open", "failure", {
        tabId,
        origin: url.origin,
      });
      throw error;
    }
  }

  back(sessionId: string, ownerId: string, tabId: string, timeoutMs = 30_000) {
    return this.historyNavigation(sessionId, ownerId, tabId, "back", timeoutMs);
  }
  forward(sessionId: string, ownerId: string, tabId: string, timeoutMs = 30_000) {
    return this.historyNavigation(sessionId, ownerId, tabId, "forward", timeoutMs);
  }
  refresh(sessionId: string, ownerId: string, tabId: string, timeoutMs = 30_000) {
    return this.reload(sessionId, ownerId, tabId, timeoutMs);
  }

  async reload(sessionId: string, ownerId: string, tabId: string, timeoutMs = 30_000) {
    const session = this.sessions.get(sessionId, ownerId);
    requirePermission(session.descriptor.permissions, "navigate");
    const tab = this.tab(session, tabId);
    await tab.page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
    await this.refreshMetadata(tab.page, tab.descriptor);
    return this.describeTab(session, tabId);
  }

  async waitForLoad(sessionId: string, ownerId: string, tabId: string, timeoutMs = 30_000) {
    const session = this.sessions.get(sessionId, ownerId);
    await this.tab(session, tabId).page.waitForLoadState("load", { timeout: timeoutMs });
  }

  async waitForNetworkIdle(sessionId: string, ownerId: string, tabId: string, timeoutMs = 30_000) {
    const session = this.sessions.get(sessionId, ownerId);
    await this.tab(session, tabId).page.waitForLoadState("networkidle", { timeout: timeoutMs });
  }

  async screenshot(
    sessionId: string,
    ownerId: string,
    tabId: string,
    options: { fullPage?: boolean; selector?: string } = {},
  ): Promise<ScreenshotArtifact> {
    const session = this.sessions.get(sessionId, ownerId);
    requirePermission(session.descriptor.permissions, "screenshot");
    const page = this.tab(session, tabId).page;
    const bytes = options.selector
      ? await page.locator(options.selector).screenshot({ type: "png" })
      : await page.screenshot({ type: "png", fullPage: options.fullPage ?? false });
    const stored = await this.artifacts.writePng(sessionId, bytes);
    const artifact: ScreenshotArtifact = {
      ...stored,
      sessionId,
      tabId,
      kind: options.selector ? "element" : options.fullPage ? "full-page" : "viewport",
      mimeType: "image/png",
      byteLength: bytes.length,
      createdAt: new Date().toISOString(),
    };
    await audit(this.auditSink, session, "screenshot.captured", "success", {
      tabId,
      kind: artifact.kind,
      byteLength: bytes.length,
    });
    return artifact;
  }

  async domSnapshot(sessionId: string, ownerId: string, tabId: string): Promise<DomSnapshot> {
    const session = this.sessions.get(sessionId, ownerId);
    requirePermission(session.descriptor.permissions, "dom_snapshot");
    const page = this.tab(session, tabId).page;
    const root = await page.evaluate(() => {
      let nextId = 0;
      const visit = (element: Element, depth = 0): import("./types").DomNodeSnapshot => {
        const tag = element.tagName.toLowerCase();
        const attributes: Record<string, string> = {};
        for (const name of [
          "id",
          "name",
          "type",
          "href",
          "aria-label",
          "aria-expanded",
          "disabled",
        ]) {
          const value = element.getAttribute(name);
          if (value !== null) attributes[name] = value.slice(0, 500);
        }
        const role =
          element.getAttribute("role") ||
          ({
            a: "link",
            button: "button",
            input: "textbox",
            img: "img",
            nav: "navigation",
            main: "main",
          }[tag] ??
            "generic");
        const children =
          depth < 30
            ? [...element.children].slice(0, 500).map((child) => visit(child, depth + 1))
            : [];
        const directText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2_000);
        return {
          nodeId: nextId++,
          role,
          name: element.getAttribute("aria-label")?.slice(0, 500),
          tag,
          text: directText || undefined,
          attributes: Object.keys(attributes).length ? attributes : undefined,
          children: children.length ? children : undefined,
        };
      };
      return visit(document.documentElement);
    });
    await audit(this.auditSink, session, "dom.captured", "success", { tabId });
    return {
      url: page.url(),
      title: await page.title(),
      capturedAt: new Date().toISOString(),
      root,
    };
  }

  private tab(session: RuntimeSession, tabId: string) {
    const tab = session.tabs.get(tabId);
    if (!tab) throw runtimeError("tab_not_found", "Browser tab not found");
    return tab;
  }

  private describeTab(session: RuntimeSession, tabId: string): TabDescriptor {
    const descriptor = this.tab(session, tabId).descriptor;
    return { ...descriptor, history: [...descriptor.history] };
  }

  private recordNavigation(descriptor: TabDescriptor, url: string) {
    const history = descriptor.history.slice(0, descriptor.historyIndex + 1);
    history.push(url);
    descriptor.history = history;
    descriptor.historyIndex = history.length - 1;
  }

  private async refreshMetadata(page: Page, descriptor: TabDescriptor) {
    descriptor.url = page.url();
    descriptor.title = await page.title();
    descriptor.faviconUrl =
      (await page.locator('link[rel~="icon"]').first().getAttribute("href")) ?? undefined;
  }

  private async historyNavigation(
    sessionId: string,
    ownerId: string,
    tabId: string,
    direction: "back" | "forward",
    timeoutMs: number,
  ) {
    const session = this.sessions.get(sessionId, ownerId);
    requirePermission(session.descriptor.permissions, "navigate");
    const tab = this.tab(session, tabId);
    await (direction === "back"
      ? tab.page.goBack({ waitUntil: "domcontentloaded", timeout: timeoutMs })
      : tab.page.goForward({ waitUntil: "domcontentloaded", timeout: timeoutMs }));
    tab.descriptor.historyIndex += direction === "back" ? -1 : 1;
    tab.descriptor.historyIndex = Math.max(
      0,
      Math.min(tab.descriptor.historyIndex, tab.descriptor.history.length - 1),
    );
    await this.refreshMetadata(tab.page, tab.descriptor);
    return this.describeTab(session, tabId);
  }
}
