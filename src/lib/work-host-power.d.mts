export function parseWorkHostPowerConfiguration(
  env: (key: string) => string | undefined,
): { resourceId: string } | null;
export function createWorkHostPower(input: {
  resourceId: string;
  getToken: () => Promise<string>;
  fetcher?: typeof fetch;
}): { state(): Promise<string>; wake(): Promise<string>; suspend(): Promise<string> };
export function createWorkHostIdleControl(input?: { idleMs?: number; now?: () => number }): {
  enter(): () => void;
  touch(): void;
  readonly draining: boolean;
  suspendIfIdle(input: {
    localIdle(): boolean;
    backendIdle(): Promise<boolean>;
    suspend(): Promise<unknown>;
  }): Promise<boolean>;
};
