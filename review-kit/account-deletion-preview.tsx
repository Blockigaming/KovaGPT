import { useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountDeletionGraceView } from "@/components/AccountDeletionGraceView";
import { Button } from "@/components/ui/button";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import {
  ACCOUNT_DELETION_PREVIEW_STATES,
  ACCOUNT_DELETION_REVIEW_LABEL,
  accountDeletionPreviewReducer,
  createAccountDeletionPreview,
} from "./account-deletion-preview-state.mjs";

function AccountDeletionPreview() {
  const [model, dispatch] = useReducer(accountDeletionPreviewReducer, undefined, () =>
    createAccountDeletionPreview(),
  );
  const [theme, setTheme] = useState("dark");
  const [fixture, setFixture] = useState("confirm");
  const [scheduleResult, setScheduleResult] = useState<"success" | "failure">("success");
  const [recoveryResult, setRecoveryResult] = useState<"success" | "failure">("success");
  const returnRef = useRef<{ target: HTMLButtonElement; url: string; ownerId: string } | null>(
    null,
  );
  const currentOwnerRef = useRef(model.ownerId);
  currentOwnerRef.current = model.ownerId;
  const identity = { ownerId: model.ownerId, generation: model.generation };
  const controlClass =
    "min-h-11 max-w-full rounded-lg border border-border bg-background px-3 text-sm";
  return (
    <main className="min-h-dvh bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <h1 className="text-xl font-semibold">Account deletion and recovery review</h1>
        <p className="text-sm text-muted-foreground">
          {ACCOUNT_DELETION_REVIEW_LABEL}. All dates, identities, outcomes, and account states on
          this page are sample data. No API requests, sign-out, storage cleanup, provider calls, or
          account changes occur. Production scheduling and recovery remain unavailable.
        </p>
        <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-semibold">Review controls · Synthetic only</legend>
          <label className="grid gap-2 text-sm">
            State fixture
            <select
              className={controlClass}
              value={fixture}
              onChange={(event) => {
                setFixture(event.target.value);
                dispatch({ ...identity, type: "fixture", fixture: event.target.value });
              }}
            >
              {ACCOUNT_DELETION_PREVIEW_STATES.map((state) => (
                <option key={state} value={state}>
                  {state === "deleting"
                    ? "deleting · explicitly started"
                    : state === "deleted"
                      ? "deleted · explicitly completed"
                      : state}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Sample account
            <select
              className={controlClass}
              value={model.ownerId}
              onChange={(event) => {
                setFixture("confirm");
                dispatch({ type: "switch-owner", nextOwnerId: event.target.value });
              }}
            >
              <option value="sample-owner-a">Sample account A</option>
              <option value="sample-owner-b">Sample account B</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Next schedule attempt
            <select
              className={controlClass}
              value={scheduleResult}
              onChange={(event) => setScheduleResult(event.target.value as "success" | "failure")}
            >
              <option value="success">Synthetic success</option>
              <option value="failure">Synthetic rejection</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Next recovery attempt
            <select
              className={controlClass}
              value={recoveryResult}
              onChange={(event) => setRecoveryResult(event.target.value as "success" | "failure")}
            >
              <option value="success">Synthetic success</option>
              <option value="failure">Synthetic rejection</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Theme
            <select
              className={controlClass}
              value={theme}
              onChange={(event) => {
                setTheme(event.target.value);
                document.documentElement.classList.toggle("dark", event.target.value === "dark");
              }}
            >
              <option>dark</option>
              <option>light</option>
            </select>
          </label>
        </fieldset>
        <section
          className="space-y-3 rounded-xl border border-border p-4"
          aria-label="Sample account status"
        >
          <h2 className="text-sm font-semibold">
            {model.ownerId === "sample-owner-a" ? "Sample account A" : "Sample account B"}
          </h2>
          <p role="status" className="text-sm text-muted-foreground">
            Synthetic state: {model.status}.{" "}
            {model.schedule?.overdue
              ? "Recovery window expired; actual deletion status unknown."
              : "The clock never starts deletion."}
          </p>
          <Button
            type="button"
            onClick={(event) => {
              returnRef.current = {
                target: event.currentTarget,
                url: window.location.href,
                ownerId: model.ownerId,
              };
              dispatch({ ...identity, type: "open" });
            }}
          >
            Open account deletion preview
          </Button>
        </section>
        <AccountDeletionGraceView
          open={model.open}
          onOpenChange={(next) => dispatch({ ...identity, type: next ? "open" : "close" })}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = returnRef.current;
            restoreDialogFocus(
              previous?.target,
              previous?.url,
              previous?.ownerId !== currentOwnerRef.current,
            );
            returnRef.current = null;
          }}
          status={model.status}
          schedule={model.schedule}
          reviewLabel={ACCOUNT_DELETION_REVIEW_LABEL}
          onSchedule={() => dispatch({ ...identity, type: "schedule", result: scheduleResult })}
          onRecover={() => dispatch({ ...identity, type: "recover", result: recoveryResult })}
          onCheckStatus={() => dispatch({ ...identity, type: "check-status" })}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<AccountDeletionPreview />);
