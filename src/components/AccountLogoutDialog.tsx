import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";

/** Shared by chat and secondary pages; opening logout never navigates away. */
export function AccountLogoutDialog() {
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerkSafe();
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("kova-confirm-logout", show);
    return () => window.removeEventListener("kova-confirm-logout", show);
  }, []);
  useEffect(() => setOpen(false), [user?.id]);
  return (
    <LogoutConfirmDialog
      open={open}
      onOpenChange={setOpen}
      onConfirm={async () => {
        try {
          await signOut();
        } catch {
          toast.error("Couldn't sign out. Try again.");
          throw new Error("sign_out_failed");
        }
      }}
    />
  );
}
