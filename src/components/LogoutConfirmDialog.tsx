import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
      <DialogContent className="sm:max-w-[440px] p-0 border-0 bg-transparent shadow-none [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">Log out</DialogTitle>
        <div className="rounded-3xl border border-border/60 bg-card shadow-2xl p-7 animate-in fade-in-0 zoom-in-95 duration-200">

          <h2 className="text-center text-[22px] leading-tight font-semibold tracking-tight">
            Are you sure you want to log out?
          </h2>

          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/70 px-4 py-3">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center text-sm font-medium">
              {avatar ? (
                <img src={avatar} alt={name} className="h-full w-full object-cover" />
              ) : (
                <span>{initial}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{name}</div>
              {email && email !== name && (
                <div className="truncate text-[13px] text-muted-foreground">{email}</div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={async () => {
                await onConfirm();
                onOpenChange(false);
              }}
              className="w-full h-12 rounded-full bg-foreground text-background font-medium hover:opacity-90 transition"
            >
              Log out
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="w-full h-12 rounded-full border border-border font-medium hover:bg-accent transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
