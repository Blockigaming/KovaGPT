import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PanelLeft, ChevronDown, ChevronLeft, ChevronRight, ImageIcon, ArrowUp, Mic } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog, type Settings, DEFAULT_SETTINGS } from "@/components/SettingsDialog";
import { HelpDialog } from "@/components/HelpDialog";
import {
  SignInButton,
  SignUpButton,
  SignedIn,
  UserButton,
  useUser,
} from "@/components/auth/ClerkSafe";

export const Route = createFileRoute("/images")({
  component: ImagesPage,
  head: () => ({
    meta: [
      { title: "Images — NovaGPT" },
      { name: "description", content: "Create and explore AI-generated images with NovaGPT." },
    ],
  }),
});

const PRESETS = [
  { label: "Disco mode", gradient: "from-slate-200 via-slate-400 to-slate-600" },
  { label: "Improve Your Desk Setup", gradient: "from-amber-100 via-orange-200 to-rose-300" },
  { label: "Wanderlust", gradient: "from-fuchsia-300 via-purple-400 to-indigo-600" },
  { label: "Scribble", gradient: "from-emerald-200 via-teal-300 to-cyan-400" },
  { label: "Chibi stickers", gradient: "from-pink-200 via-rose-300 to-orange-300" },
  { label: "Cinematic portrait", gradient: "from-zinc-700 via-zinc-900 to-black" },
];

function ImagesPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [prompt, setPrompt] = useState("");

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <Sidebar
        conversations={[]}
        activeId={null}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center px-3 border-b border-border">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-accent transition mr-1"
              aria-label="Open sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-accent transition font-semibold">
            <span>NovaGPT</span>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            {isLoaded && isSignedIn ? (
              <SignedIn>
                <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
              </SignedIn>
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="text-sm font-medium px-4 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm font-medium px-3 sm:px-4 py-1.5 rounded-full hover:bg-accent transition whitespace-nowrap">
                    Sign up for free
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <h1 className="text-3xl font-semibold mb-6">Images</h1>

            <div className="rounded-3xl border border-border bg-card shadow-sm">
              <div className="flex items-center px-4 py-3 gap-2">
                <ImageIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe a new image"
                  className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-accent flex items-center justify-center transition"
                  aria-label="Voice input"
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={!prompt.trim()}
                  className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition"
                  aria-label="Generate"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Create an image</h2>
                <div className="flex items-center gap-1">
                  <button className="w-8 h-8 rounded-full border border-border hover:bg-accent flex items-center justify-center" aria-label="Previous">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button className="w-8 h-8 rounded-full border border-border hover:bg-accent flex items-center justify-center" aria-label="Next">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={`relative aspect-[3/4] rounded-2xl overflow-hidden bg-gradient-to-br ${p.gradient} hover:scale-[1.02] transition-transform`}
                  >
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                      <div className="text-sm font-medium text-white text-left">{p.label}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={DEFAULT_SETTINGS as Settings}
        onChange={() => {}}
        onClearAll={() => {}}
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
