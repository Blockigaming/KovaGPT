import { toast } from "sonner";
import { acceptFamilyInvite } from "@/lib/family.functions";

export async function redeemFamilyInvite(token: string, url: URL) {
  try {
    await acceptFamilyInvite({ data: { token } });
    toast.success("Joined family plan.");
  } catch (error) {
    toast.error((error as Error).message || "Could not accept invite.");
  } finally {
    if (window.location.href === url.href) {
      url.searchParams.delete("family_invite");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }
}
