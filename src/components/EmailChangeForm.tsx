import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCapturedKovaPrincipal, kovaAuthJson } from "@/lib/kova-auth-browser";

export function EmailChangeForm({ ownerId }: { ownerId: string }) {
  const [email, setEmail] = useState("");
  const [requestedEmail, setRequestedEmail] = useState("");
  const [oldCode, setOldCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState("");
  if (changed) return <p role="status">Email updated. Sign in again using {requestedEmail}.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const principal = getCapturedKovaPrincipal();
        if (principal?.accountId !== ownerId) {
          setError("Sign in with Kova Auth to change your email.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          const response = await kovaAuthJson(
            "/api/auth/change-email",
            requestedEmail
              ? {
                  action: "confirm",
                  email: requestedEmail,
                  oldCode: oldCode.trim(),
                  newCode: newCode.trim(),
                }
              : { action: "start", email },
            principal,
          );
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Email change failed.");
          if (result.changed === true) setChanged(true);
          else if (result.sent === true) setRequestedEmail(email);
          else throw new Error("Email change could not be confirmed.");
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Email change failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {requestedEmail ? (
        <>
          <p role="status">
            Enter the codes sent to your current address and {requestedEmail}. After confirmation,
            sign in again with your new address.
          </p>
          <label className="grid gap-2">
            Code from current email
            <Input
              required
              value={oldCode}
              onChange={(event) => setOldCode(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="grid gap-2">
            Code from new email
            <Input
              required
              value={newCode}
              onChange={(event) => setNewCode(event.target.value)}
              autoComplete="off"
            />
          </label>
        </>
      ) : (
        <label className="grid gap-2">
          New email address
          <Input
            required
            type="email"
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {requestedEmail ? "Confirm email change" : "Send confirmation codes"}
        </Button>
        {requestedEmail && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setRequestedEmail("");
              setOldCode("");
              setNewCode("");
              setError("");
            }}
          >
            Start over
          </Button>
        )}
      </div>
    </form>
  );
}
