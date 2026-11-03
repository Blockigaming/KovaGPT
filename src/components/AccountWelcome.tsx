import { PublicWebsiteHome } from "@/components/public/PublicWebsite";

export default function AccountWelcome({ pending = false }: { pending?: boolean }) {
  return <PublicWebsiteHome pending={pending} />;
}
