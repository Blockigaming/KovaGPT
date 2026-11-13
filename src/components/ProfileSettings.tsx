import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useId, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveAccountProfile, type AccountProfile } from "@/lib/account-profile.functions";
import { ACCOUNT_PROFILE_CHANGED, useAccountProfile } from "@/lib/use-account-profile";
import { toast } from "sonner";
import { User2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Settings } from "@/components/SettingsDialog";
import type { useUser } from "@/components/auth/ClerkSafe";
import { saveStoredSettings } from "@/lib/settings-storage";
import { saveDevicePreferredName } from "@/lib/profile-preferences.mjs";
import { timeFormatValue } from "@/lib/time-format";

export function ProfileSettings({
  user,
  principalResolved,
  settings,
  onChange,
}: {
  user: ReturnType<typeof useUser>["user"];
  principalResolved: boolean;
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const [deviceLocale, setDeviceLocale] = useState({
    timezone: "Detecting…",
    timeFormat: "Detecting…",
  });
  const currentOwnerRef = useRef<string | null | undefined>(undefined);
  currentOwnerRef.current = principalResolved ? (user?.id ?? null) : undefined;
  useEffect(() => {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const format = Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
      setDeviceLocale({
        timezone: timezone || "Unavailable",
        timeFormat: format.hour12 ? "12-hour" : "24-hour",
      });
    } catch {
      setDeviceLocale({ timezone: "Unavailable", timeFormat: "Unavailable" });
    }
  }, []);
  return (
    <div className="kova-profile-settings space-y-6" data-ui-reference="chatgpt.settings.profile">
      <AccountProfileEditor key={user?.id ?? "guest"} user={principalResolved ? user : null} />
      <PreferredNameForm
        key={`${principalResolved ? (user?.id ?? "guest") : "loading"}:${settings.displayName}`}
        ownerId={user?.id ?? null}
        currentOwnerId={() => currentOwnerRef.current}
        settings={settings}
        onChange={onChange}
      />
      <section className="space-y-4" aria-labelledby="profile-language-region">
        <h3 id="profile-language-region" className="text-sm font-semibold">
          Language and region
        </h3>
        <label className="grid gap-2 text-sm">
          Interface language
          <Input value="English" readOnly aria-describedby="profile-language-limit" />
        </label>
        <p id="profile-language-limit" className="text-xs text-muted-foreground">
          Other interface languages are unavailable. Ask for a reply in another language in your
          chat or custom instructions.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">
            Timezone detected on this device
            <Input value={deviceLocale.timezone} readOnly aria-describedby="profile-time-limit" />
          </label>
          <label className="grid gap-2 text-sm">
            Time format
            <Select
              value={timeFormatValue(settings.timeFormat)}
              disabled={!principalResolved || !user?.id}
              onValueChange={(value) => {
                if (!principalResolved || !user?.id || currentOwnerRef.current !== user.id) return;
                onChange({ ...settings, timeFormat: timeFormatValue(value) });
              }}
            >
              <SelectTrigger
                aria-label="Time format"
                aria-describedby="profile-time-limit"
                className="min-h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">Device default ({deviceLocale.timeFormat})</SelectItem>
                <SelectItem value="12-hour">12-hour (1:00 PM)</SelectItem>
                <SelectItem value="24-hour">24-hour (13:00)</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <p id="profile-time-limit" className="text-xs text-muted-foreground">
          Time format saves automatically for this account in this browser and applies to scheduled
          tasks, activity, usage resets, and file metadata. Cross-device sync and an account
          timezone preference are unavailable. Scheduled tasks keep their own timezone; daily usage
          resets stay at midnight UTC. Date-only labels and native time inputs keep their existing
          formats.
        </p>
      </section>
    </div>
  );
}

async function resizeProfilePhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error("Choose a JPEG, PNG, or WebP image under 8 MB.");
  const bitmap = await createImageBitmap(file, { resizeWidth: 256, resizeHeight: 256 });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The photo could not be processed.");
    context.drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    bitmap.close();
  }
}

function AccountProfileEditor({ user }: { user: ReturnType<typeof useUser>["user"] }) {
  const ownerId = user?.id ?? null;
  const { profile, loaded, failed, retry } = useAccountProfile(ownerId);
  const save = useServerFn(saveAccountProfile);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const name = draft ?? profile?.name ?? user?.fullName ?? "";
  const photo = profile?.photo === undefined ? user?.imageUrl : profile.photo;
  const disabled = !ownerId || !loaded || failed || busy;
  async function update(build: () => Promise<Partial<AccountProfile>>) {
    if (!ownerId || disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const saved = await save({ data: { ownerId, profile: await build() } });
      window.dispatchEvent(
        new CustomEvent(ACCOUNT_PROFILE_CHANGED, { detail: { ownerId, profile: saved } }),
      );
      setDraft(null);
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your profile could not be saved.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="Account details">
      <div className="kova-settings-reference-row">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12" aria-label="Profile photo">
            {photo && <AvatarImage src={photo} alt="" />}
            <AvatarFallback>
              <User2 aria-hidden="true" />
            </AvatarFallback>
          </Avatar>
          <span>Profile photo</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file)
                void update(async () => ({
                  photo: await resizeProfilePhoto(file),
                }));
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            Change photo
          </Button>
          {photo && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => void update(async () => ({ photo: null }))}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <form
        className="kova-settings-reference-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void update(async () => ({ name: name.trim() }));
        }}
      >
        <label className="grid gap-2 text-sm">
          Display name
          <Input
            value={name}
            maxLength={120}
            required
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || draft === null || !name.trim()}
        >
          Save changes
        </Button>
      </form>
      {failed && (
        <Button type="button" variant="outline" onClick={retry}>
          Retry loading profile
        </Button>
      )}
    </section>
  );
}

function PreferredNameForm({
  ownerId,
  currentOwnerId,
  settings,
  onChange,
}: {
  ownerId: string | null;
  currentOwnerId: () => string | null | undefined;
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(settings.displayName);
  const [error, setError] = useState<string | null>(null);
  const changed = draft !== settings.displayName;
  return (
    <form
      className="space-y-3"
      aria-label="Preferred name on this device"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed) return;
        const result = saveDevicePreferredName({
          settings,
          value: draft,
          ownerId,
          currentOwnerId: currentOwnerId(),
          save: saveStoredSettings,
        });
        if (!result.settings) {
          setError(result.error);
          return;
        }
        onChange(result.settings);
        setDraft(result.settings.displayName);
        setError(null);
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        Preferred name for chats on this device
      </label>
      <Input
        id={id}
        className="kova-personalization-name"
        value={draft}
        disabled={!ownerId}
        maxLength={80}
        autoComplete="nickname"
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-scope${error ? ` ${id}-error` : ""}`}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
      />
      <p id={`${id}-scope`} className="text-xs text-muted-foreground">
        A response preference for this account in this browser. Saving it does not rename your
        account. Leave blank to use no preferred name.
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ownerId || !changed}>
          Save changes
        </Button>
        <Button
          type="button"
          variant="outline"
          className="kova-profile-disabled-outline"
          disabled={!changed && !error}
          onClick={() => {
            setDraft(settings.displayName);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
