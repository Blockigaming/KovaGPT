import type { OnboardingResponseLength } from "@/components/OnboardingDialog";

export interface OnboardingHandoff {
  ownerId: string;
  responseLength: OnboardingResponseLength;
  starter?: string;
}

let pendingHandoff: OnboardingHandoff | null = null;

export function stageOnboardingHandoff(handoff: OnboardingHandoff): void {
  pendingHandoff = { ...handoff };
}

export function consumeOnboardingHandoff(ownerId: string): OnboardingHandoff | null {
  const handoff = pendingHandoff;
  pendingHandoff = null;
  return handoff?.ownerId === ownerId ? handoff : null;
}
