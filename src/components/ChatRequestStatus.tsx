import { SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";

export default function ChatRequestStatus({
  signedIn,
  blocked,
  canSignIn,
}: {
  signedIn: boolean;
  blocked: boolean;
  canSignIn: () => boolean;
}) {
  return (
    <section
      className="mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
      role="status"
      data-testid="chat-request-status"
    >
      <>
        <p>
          {signedIn
            ? "Your session could not be verified. Sign in again to continue."
            : "Sign in is required for this request."}{" "}
          Signing in does not resend a message. It may change the current account.
        </p>
        {blocked && (
          <p>
            Save or copy your current message and attachments, then clear them before signing in.
            Cancel or save any next message too. Drafts are not transferred between accounts.
          </p>
        )}
        <SignInButton mode="modal">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={blocked}
            onClick={(event) => {
              if (!canSignIn()) event.preventDefault();
            }}
          >
            Sign in
          </Button>
        </SignInButton>
      </>
    </section>
  );
}
