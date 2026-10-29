import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUser } from "@/components/auth/ClerkSafe";

export function LogoutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { user } = useUser();
  const name = user?.fullName || user?.firstName || user?.email || "You";
  const email = user?.email;
  const avatar = user?.imageUrl;
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ui-reference="chatgpt.auth.logout-confirmation"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Log out</DialogTitle>
        <DialogHeader className="text-center">
          <h2 className="text-lg font-semibold leading-6">Are you sure you want to log out?</h2>
        </DialogHeader>
        <div
          className="flex items-center gap-3 rounded-xl border border-border px-3 py-3"
          data-ui-reference="chatgpt.settings.account.identity"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium">
            {avatar ? (
              <img src={avatar} alt={name} className="h-full w-full object-cover" />
            ) : (
              <span>{initial}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name}</div>
            {email && email !== name && (
              <div className="truncate text-xs text-muted-foreground">{email}</div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            data-ui-reference="chatgpt.auth.logout-confirmation.action"
            size="prominent"
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            className="w-full"
          >
            Log out
          </Button>
          <Button
            data-ui-reference="chatgpt.auth.logout-confirmation.action"
            variant="outline"
            size="prominent"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
