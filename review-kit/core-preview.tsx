import { useRef, useState } from "react";
import { ResponseCopyPreview } from "./components/ResponseCopyPreview";
import { ResultCommentsPreview } from "./components/ResultCommentsPreview";
import { createRoot } from "react-dom/client";
import { IntroductoryOfferPreview } from "./components/IntroductoryOfferPreview";
import { ControlSheet } from "./components/ControlSheet";
import { VerificationPreview } from "./components/VerificationPreview";
import { TaskDeliveryPreview } from "./components/TaskDeliveryPreview";
import { SupportRequestPreview } from "./components/SupportRequestPreview";
import { SharedConversationPreview } from "./components/SharedConversationPreview";
import { SessionsPreview } from "./components/SessionsPreview";
import { BillingManagementPreview } from "./components/BillingManagementPreview";

import { LibraryOrganizationPreview } from "./components/LibraryOrganizationPreview";

function BillingSurface() {
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Billing management preview</h1>
      <p className="text-sm text-muted-foreground">
        Inspect proposed invoice, plan-change and cancellation interfaces with local sample data.
        Amounts and commercial terms require confirmation.
      </p>
      <button
        ref={openerRef}
        className="min-h-11 rounded-xl border px-4"
        onClick={() => setOpen(true)}
      >
        Open billing preview
      </button>
      <BillingManagementPreview open={open} onOpenChange={setOpen} returnFocusRef={openerRef} />
    </section>
  );
}

const screens = {
  "Response copy": ResponseCopyPreview,
  "Result comments": ResultCommentsPreview,
  "Introductory offer": IntroductoryOfferPreview,
  "Control sheet": ControlSheet,
  "Email verification": VerificationPreview,
  "Task delivery": TaskDeliveryPreview,
  "Library organization": LibraryOrganizationPreview,
  Support: SupportRequestPreview,
  "Shared conversation": SharedConversationPreview,
  Sessions: SessionsPreview,
  "Billing management": BillingSurface,
};
function CorePreview() {
  const [screen, setScreen] = useState<keyof typeof screens>("Support");
  const [theme, setTheme] = useState("dark");
  const [generation, setGeneration] = useState(0);
  const Screen = screens[screen];
  if (new URLSearchParams(window.location.search).has("controlSheetFrame")) {
    return <ControlSheet />;
  }
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">KovaGPT · private interface review</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Proposed interfaces with local sample data. No account, payment, sharing or support
              action is sent.
            </p>
          </div>
          <button
            className="min-h-11 rounded-xl border px-4"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              document.documentElement.classList.toggle("dark", next === "dark");
              document.documentElement.style.colorScheme = next;
            }}
          >
            {theme === "dark" ? "Light" : "Dark"} appearance
          </button>
        </div>
      </header>
      <main
        className={`mx-auto space-y-6 px-4 py-6 sm:px-6 ${screen === "Control sheet" ? "w-full" : "max-w-5xl"}`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 space-y-2 text-sm">
            <span className="block font-medium">Review surface</span>
            <select
              className="min-h-11 w-full rounded-xl border bg-background px-3"
              value={screen}
              onChange={(e) => {
                setScreen(e.target.value as keyof typeof screens);
                setGeneration((v) => v + 1);
              }}
            >
              {Object.keys(screens).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button
            className="min-h-11 rounded-xl border px-4"
            onClick={() => setGeneration((v) => v + 1)}
          >
            Reset sample
          </button>
        </div>
        <Screen key={`${screen}:${generation}`} />
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<CorePreview />);
