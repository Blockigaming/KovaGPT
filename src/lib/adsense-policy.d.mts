export function canDisplayResponseAd(input: {
  tier: string;
  status: string;
  isLastAssistant: boolean;
  temporary?: boolean;
  streaming?: boolean;
  content?: string;
  generationStatus?: string;
}): boolean;
export function hasAdSenseConsent(data: unknown, success: boolean): boolean;
