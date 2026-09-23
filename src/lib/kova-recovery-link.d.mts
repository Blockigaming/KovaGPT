export type KovaRecoveryLink = {
  owned: boolean;
  token: string | null;
  cleanPath: string | null;
};
export function readKovaRecoveryLink(href: string, mode: string): KovaRecoveryLink;
