export function readKovaRecoveryLanding(
  href: string,
  mode?: "kova" | "dual" | "supabase",
): {
  owned: boolean;
  token: string | null;
  cleanUrl: string | null;
};
