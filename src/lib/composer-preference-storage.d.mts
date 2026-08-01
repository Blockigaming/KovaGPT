export type ComposerPreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const DEFAULT_SEND_ON_ENTER: true;
export function scopeForComposerPreference(userKey: string | null): string;
export function composerPreferenceKey(scope: string): string;
export function legacyComposerSettingsKey(scope: string): string;
export function unscopedLegacyComposerSettingsKey(): string;
export function readPersistedSendOnEnter(
  storage: ComposerPreferenceStorage,
  scope: string,
): boolean;
