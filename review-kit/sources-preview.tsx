import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationSourcesView } from "@/components/ConversationSourcesView";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { transitionBrowserPreview } from "./browser-takeover-fixture.mjs";
import "@/components/conversation-header.css";
function SourcesPreview() {
  const [state, setState] = useState<"active" | "completed" | "failed" | "canceled" | "empty">(
    "active",
  );
  const [session, setSession] = useState("active");
  const [open, setOpen] = useState(false);
  const [popover, setPopover] = useState(false);
  const [note, setNote] = useState("");
  const [sampleText, setSampleText] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const action = (value: string) => {
    setSession((old) => transitionBrowserPreview(old, value));
    if (value === "release" || value === "end") setSampleText("");
  };
  const sample = (
    <span className="kova-sample-browser-thumbnail">
      <span className="kova-sample-browser-toolbar">
        ● ● ● <span>example.invalid</span>
      </span>
      <span className="kova-sample-browser-page">
        <strong>Sample workspace</strong>
        <span>Research notes</span>
        <span className="kova-sample-browser-line" />
        <span className="kova-sample-browser-line" />
      </span>
      <span className="kova-sample-browser-badge">Synthetic preview</span>
    </span>
  );
  return (
    <main className="min-h-dvh bg-background p-5 text-foreground">
      <h1 className="text-xl font-semibold">Browser activity presentation</h1>
      <p className="my-3 text-sm text-muted-foreground">
        Synthetic state only. No browser session, provider request or website connection occurs.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          State{" "}
          <select
            className="min-h-11 rounded-lg border bg-background px-3"
            value={state}
            onChange={(e) => {
              setState(e.target.value as typeof state);
              setSession("active");
              setOpen(false);
              setSampleText("");
              setNote("");
            }}
          >
            {["active", "completed", "failed", "canceled", "empty"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Theme{" "}
          <select
            className="min-h-11 rounded-lg border bg-background px-3"
            defaultValue="dark"
            onChange={(e) =>
              document.documentElement.classList.toggle("dark", e.target.value === "dark")
            }
          >
            <option>dark</option>
            <option>light</option>
          </select>
        </label>
        <Popover open={popover} onOpenChange={setPopover}>
          <PopoverTrigger ref={opener} className="min-h-11 rounded-lg border px-4">
            Open Outputs
          </PopoverTrigger>
          <PopoverContent
            className="kova-conversation-outputs"
            align="start"
            onCloseAutoFocus={(e) => {
              if (open) e.preventDefault();
            }}
          >
            {state === "empty" && <p className="kova-header-note">No recorded activity.</p>}
            <ConversationSourcesView
              inventory={{
                web: [],
                memory: [],
                attachments: [],
                browser:
                  state === "empty"
                    ? []
                    : [
                        {
                          id: "sample-browser",
                          kind: "browser",
                          messageId: "sample",
                          tool: "browser_interact",
                          label: "Sample session",
                          status: state,
                        },
                      ],
              }}
              onOpenAttachment={() => {}}
              onOpenMemory={() => {}}
              onOpenBrowser={() => {
                setPopover(false);
                setOpen(true);
              }}
              browserPreview={sample}
            />
          </PopoverContent>
        </Popover>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSampleText("");
        }}
      >
        <DialogContent
          className="sm:max-w-xl"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogTitle>Sample cloud browser</DialogTitle>
          <DialogDescription>
            Isolated interaction preview. Controls change only this sample; nothing is sent to a
            website.
          </DialogDescription>
          {sample}
          <p role="status" className="text-sm">
            {session === "owner"
              ? "You have control. Automation is paused."
              : session === "paused"
                ? "Automation paused. No action is in flight."
                : session === "ended"
                  ? "Session ended. No further interaction is available."
                  : state === "active"
                    ? "Sample automation is active. Pause before taking control."
                    : "This recorded session is no longer open."}
          </p>
          {session === "owner" && (
            <label className="text-sm">
              Sample page text
              <input
                className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3"
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                placeholder="Type only sample text"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {state === "active" && session === "active" && (
              <button
                className="min-h-11 rounded-full bg-foreground px-5 text-background"
                onClick={() => action("pause")}
              >
                Pause to take over
              </button>
            )}
            {state === "active" && session === "paused" && (
              <>
                <button
                  className="min-h-11 rounded-full bg-foreground px-5 text-background"
                  onClick={() => action("takeover")}
                >
                  Take over
                </button>
                <button
                  className="min-h-11 rounded-full border px-5"
                  onClick={() => action("resume")}
                >
                  Resume automation
                </button>
              </>
            )}
            {session === "owner" && (
              <button
                className="min-h-11 rounded-full bg-foreground px-5 text-background"
                onClick={() => action("release")}
              >
                Return control
              </button>
            )}
            {state === "active" && session !== "ended" && (
              <button
                className="min-h-11 rounded-full border px-5"
                onClick={() => {
                  action("end");
                  setNote("Sample session ended.");
                }}
              >
                End session
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Closing this panel does not resume automation. Returning control clears sample form
            text; Resume automation is a separate action.
          </p>
        </DialogContent>
      </Dialog>
      {note && (
        <p role="status" className="mt-4 text-sm">
          {note}
        </p>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<SourcesPreview />);
