import { useCallback, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { ResponsiveModelSelector } from "@/components/ResponsiveModelSelector";
import { WorkspaceModeSwitch } from "@/components/WorkspaceModeSwitch";
import { ChatInput, type PendingAttachment } from "@/components/ChatInput";
import { HomeChatStarters } from "@/components/HomeChatStarters";
import type { ModeId } from "@/lib/modes";
import type { ComposerToolId } from "@/lib/chat-store";
import { useUser } from "./auth";

// Real application components; only account/services are isolated. This is not
// the full routed app, and it never authenticates, uploads, or invokes a model.
export function ChatWorkspaceFixture() {
  const { isSignedIn } = useUser();
  const [open, setOpen] = useState(() => window.innerWidth >= 1024);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ModeId>("instant");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [tool, setTool] = useState<ComposerToolId | null>(null);
  const [action, setAction] = useState("No action taken");
  const toggleSidebar = useCallback(() => setOpen((v) => !v), []);
  const tier = isSignedIn ? "pro" : "free";
  const newChat = () => {
    setInput("");
    setAction("New chat selected");
  };
  return (
    <div
      className="flex h-dvh w-full overflow-hidden bg-background text-foreground"
      data-workspace-fixture
    >
      <Sidebar
        conversations={[]}
        activeId={null}
        onSelect={() => undefined}
        onNew={newChat}
        onDelete={() => undefined}
        open={open}
        onToggle={toggleSidebar}
        onOpenSettings={() => setAction("Settings requested")}
        onOpenHelp={() => setAction("Help requested")}
      />
      <main
        className="kova-chat-main flex min-w-0 flex-1 flex-col bg-background"
        data-sidebar={open ? "open" : "closed"}
      >
        <MobileTopBar
          onOpenSidebar={() => setOpen(true)}
          onNewChat={newChat}
          mode={mode}
          onModeChange={setMode}
          userTier={tier}
        />
        <header className="kova-topbar kova-desktop-topbar relative hidden h-[56px] items-center gap-1 px-4 lg:flex">
          {!open && !isSignedIn ? (
            <button
              type="button"
              aria-label="Open sidebar"
              onClick={() => setOpen(true)}
              className="kova-action h-11 w-11"
            >
              <PanelLeftOpen />
            </button>
          ) : null}
          <ResponsiveModelSelector
            mode={mode}
            onChange={setMode}
            userTier={tier}
            placement="topbar"
          />
          {isSignedIn ? (
            <WorkspaceModeSwitch
              active="chat"
              className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 xl:flex"
            />
          ) : null}
          {!isSignedIn ? (
            <button
              type="button"
              className="ml-auto rounded-full bg-foreground px-4 py-2 text-sm text-background"
            >
              Log in
            </button>
          ) : null}
        </header>
        <section
          className="kova-empty-chat flex flex-1 flex-col overflow-y-auto px-3 lg:px-6"
          aria-labelledby="chat-greeting"
        >
          <div className="kova-empty-chat-content flex w-full flex-1 flex-col items-center justify-center py-6 lg:py-10">
            <div className="kova-greeting mb-5 flex flex-col items-center gap-3 lg:mb-6">
              <h1 id="chat-greeting" className="text-center">
                What can I help with?
              </h1>
            </div>
            <div className="mx-auto w-full max-w-[48rem] px-1 sm:px-2">
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={() => setAction("Local submit callback only")}
                onStop={() => undefined}
                isStreaming={false}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                mode={mode}
                onModeChange={setMode}
                userTier={tier}
                canChangeAgent={false}
                saveAttachmentsToLibrary={false}
                placeholder="Ask anything"
                selectedTool={tool}
                onToolSelect={setTool}
                surface="empty"
              />
            </div>
            {!isSignedIn ? <HomeChatStarters setInput={setInput} /> : null}
          </div>
          <p className="kova-disclaimer mx-auto w-full max-w-[48rem] px-4 pb-3 text-center text-[11px] leading-4 text-muted-foreground/80">
            Application component preview. Account, navigation destinations and generation services
            are not connected.
          </p>
        </section>
        <span role="status" className="sr-only">
          {action}
        </span>
      </main>
    </div>
  );
}
