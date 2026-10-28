import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useId, useRef, useState } from "react";
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
    <div className="space-y-6">
      <section className="space-y-4" aria-label="Account details">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="h-16 w-16" aria-label="Account photo">
            {user?.imageUrl ? <AvatarImage src={user.imageUrl} alt="Your account photo" /> : null}
            <AvatarFallback>
              <User2 aria-hidden="true" className="h-7 w-7" />
              <span className="sr-only">No account photo</span>
            </AvatarFallback>
          </Avatar>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="kova-profile-disabled-outline"
                disabled
                aria-describedby="profile-photo-limit"
              >
                Change photo
              </Button>
              <Button type="button" variant="ghost" disabled aria-describedby="profile-photo-limit">
                Remove photo
              </Button>
            </div>
            <p id="profile-photo-limit" className="text-xs text-muted-foreground">
              Photo editing is unavailable for this account.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">
            Account display name
            <Input
              value={user?.fullName || user?.firstName || "Not provided"}
              readOnly
              aria-describedby="profile-account-limit"
            />
          </label>
          <label className="grid gap-2 text-sm">
            Account email
            <Input
              value={user?.primaryEmailAddress?.emailAddress || "Unavailable"}
              readOnly
              aria-describedby="profile-account-limit"
            />
          </label>
        </div>
        <p id="profile-account-limit" className="text-xs text-muted-foreground">
          These account fields are read-only. Account name editing and verified email changes are
          unavailable here.
        </p>
      </section>
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
