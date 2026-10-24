import { useReducer, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type PluginPreviewProvider = {
  id: string;
  label: string;
  description: string;
  readCapabilities: string[];
  writeCapabilities: string[];
  permissions: string[];
  availabilityNote: string;
};
export type ConnectionPreviewStage =
  | "consent"
  | "pending"
  | "canceled"
  | "denied"
  | "failed"
  | "connected"
  | "reconnect"
  | "disconnect";
export type ConnectionPreviewState = {
  stage: ConnectionPreviewStage;
  accepted: string[];
  permissions: string[];
};
export type ConnectionPreviewAction =
  | { type: "permission"; permission: string; checked: boolean }
  | { type: "start" }
  | { type: "result"; result: "connected" | "denied" | "failed" }
  | { type: "cancel" }
  | { type: "retry" }
  | { type: "expire" }
  | { type: "disconnect" }
  | { type: "keep" }
  | { type: "confirmDisconnect" }
  | { type: "reset" };

export function createConnectionPreviewState(permissions: string[]): ConnectionPreviewState {
  return { stage: "consent", accepted: [], permissions: [...new Set(permissions)] };
}
export function connectionPreviewReducer(
  state: ConnectionPreviewState,
  action: ConnectionPreviewAction,
): ConnectionPreviewState {
  switch (action.type) {
    case "permission":
      if (state.stage !== "consent" || !state.permissions.includes(action.permission)) return state;
      return {
        ...state,
        accepted: action.checked
          ? [...new Set([...state.accepted, action.permission])]
          : state.accepted.filter((permission) => permission !== action.permission),
      };
    case "start":
      return state.stage === "consent" &&
        state.permissions.every((permission) => state.accepted.includes(permission))
        ? { ...state, stage: "pending" }
        : state;
    case "result":
      return state.stage === "pending" ? { ...state, stage: action.result } : state;
    case "cancel":
      return state.stage === "pending" || state.stage === "consent"
        ? { ...state, stage: "canceled" }
        : state;
    case "retry":
      return ["failed", "denied", "canceled", "reconnect"].includes(state.stage)
        ? createConnectionPreviewState(state.permissions)
        : state;
    case "expire":
      return state.stage === "connected" ? { ...state, stage: "reconnect" } : state;
    case "disconnect":
      return state.stage === "connected" ? { ...state, stage: "disconnect" } : state;
    case "keep":
      return state.stage === "disconnect" ? { ...state, stage: "connected" } : state;
    case "confirmDisconnect":
      return state.stage === "disconnect" ? createConnectionPreviewState(state.permissions) : state;
    case "reset":
      return createConnectionPreviewState(state.permissions);
  }
}

export function PluginConnectionPreview({
  provider,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  provider: PluginPreviewProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        closeLabel="Close connection preview"
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{provider.label} connection preview</DialogTitle>
          <DialogDescription>Connection preview · sample data</DialogDescription>
        </DialogHeader>
        {open && <PreviewSession key={provider.id} provider={provider} />}
      </DialogContent>
    </Dialog>
  );
}

function PreviewSession({ provider }: { provider: PluginPreviewProvider }) {
  const [state, dispatch] = useReducer(
    connectionPreviewReducer,
    provider.permissions,
    createConnectionPreviewState,
  );
  const ready = state.permissions.every((permission) => state.accepted.includes(permission));
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <div className="rounded-xl border bg-muted/40 p-3 text-sm">
        This interactive preview uses sample data only. It cannot connect an account, grant
        permissions, or read or change provider data.
        <p className="mt-2 text-muted-foreground">{provider.availabilityNote}</p>
      </div>
      <p className="text-sm text-muted-foreground">{provider.description}</p>
      <section aria-label="Preview capabilities" className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Read capabilities</h3>
          {provider.readCapabilities.length ? (
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {provider.readCapabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">None in this preview.</p>
          )}
        </div>
        <div className="min-w-0 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Write capabilities</h3>
          {provider.writeCapabilities.length ? (
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {provider.writeCapabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">None in this preview.</p>
          )}
        </div>
      </section>
      {state.stage === "consent" && (
        <section aria-label="Sample permission consent" className="space-y-3">
          <h3 className="font-semibold">Review sample permissions</h3>
          <p className="text-sm text-muted-foreground">
            Select each permission to simulate consent. These checkboxes grant no real access.
          </p>
          {state.permissions.map((permission) => (
            <label
              key={permission}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm"
            >
              <input
                className="mt-1 h-4 w-4 shrink-0"
                type="checkbox"
                checked={state.accepted.includes(permission)}
                onChange={(event) =>
                  dispatch({ type: "permission", permission, checked: event.target.checked })
                }
              />
              <span>{permission}</span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!ready} onClick={() => dispatch({ type: "start" })}>
              Simulate connection
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "cancel" })}>
              Cancel preview setup
            </Button>
          </div>
        </section>
      )}
      {state.stage === "pending" && (
        <section className="space-y-3">
          <p role="status" className="text-sm">
            Sample authorization pending. Choose an outcome to continue the preview; no sign-in
            window opens.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => dispatch({ type: "result", result: "connected" })}>
              Simulate success
            </Button>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "result", result: "denied" })}
            >
              Simulate permission denied
            </Button>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "result", result: "failed" })}
            >
              Simulate connection failure
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "cancel" })}>
              Cancel pending preview
            </Button>
          </div>
        </section>
      )}
      {state.stage === "connected" && (
        <section className="space-y-3 rounded-xl border p-3">
          <h3 className="font-semibold">Connected · sample state</h3>
          <p role="status" className="text-sm">
            Sample identity: preview@example.invalid. No real account is connected.
          </p>
          <p className="text-sm text-muted-foreground">
            {state.accepted.length} sample permissions selected. Provider actions remain unavailable
            here.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => dispatch({ type: "expire" })}>
              Simulate expired connection
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "disconnect" })}>
              Disconnect sample account
            </Button>
          </div>
        </section>
      )}
      {["failed", "denied", "canceled", "reconnect"].includes(state.stage) && (
        <section className="space-y-3">
          <p
            role={state.stage === "failed" || state.stage === "denied" ? "alert" : "status"}
            className="text-sm"
          >
            {state.stage === "failed"
              ? "Sample connection failed. Your real accounts are unchanged."
              : state.stage === "denied"
                ? "Sample permission request denied. No access was granted."
                : state.stage === "reconnect"
                  ? "Sample connection expired. Review permissions again to simulate reconnecting."
                  : "Sample setup canceled. No account was connected."}
          </p>
          <Button variant="outline" onClick={() => dispatch({ type: "retry" })}>
            {state.stage === "reconnect" ? "Review reconnect permissions" : "Try preview again"}
          </Button>
        </section>
      )}
      {state.stage === "disconnect" && (
        <section className="space-y-3 rounded-xl border p-3" aria-label="Confirm sample disconnect">
          <h3 className="font-semibold">Disconnect the sample account?</h3>
          <p className="text-sm">
            This clears only this preview's sample consent. It does not revoke any real provider
            access.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => dispatch({ type: "confirmDisconnect" })}>
              Confirm sample disconnect
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: "keep" })}>
              Keep sample connection
            </Button>
          </div>
        </section>
      )}
      <div className="border-t pt-3">
        <Button variant="ghost" onClick={() => dispatch({ type: "reset" })}>
          Reset local preview
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          Closing this dialog resets its sample state.
        </p>
      </div>
    </div>
  );
}
