import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trash2,
  Play,
  Palette,
  User2,
  ShieldCheck,
  Sparkles,
  CreditCard,
  ExternalLink,
  Lock,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { clearConversations } from "@/lib/chat-store";
import { getUsage, DAILY_IMAGE_LIMIT, DAILY_UPLOAD_LIMIT } from "@/lib/limits";
import {
  getVoices,
  onVoicesChanged,
  speak,
  defaultVoiceName,
  friendlyVoiceLabel,
} from "@/lib/voice";
import { useUser, clerkEnabled } from "@/components/auth/ClerkSafe";
import { useClerkSafe as useClerk } from "@/components/auth/ClerkSafe";
import {
  applyThemeMode,
  DEFAULT_THEME,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/theme";

export type Mood = "neutral" | "friendly" | "professional" | "concise";

export type Settings = {
  // Voice
  autoSpeak: boolean;
  voiceRate: number;
  voiceName: string;
  // Personalization
  displayName: string;
  email: string;
  extraFacts: string;
  customInstructions: string;
  mood: Mood;
  responseLength: "short" | "medium" | "long";
  rememberAcross: boolean;
  // Behavior
  webSearch: boolean;
  sendOnEnter: boolean;
  // Appearance
  mode: ThemeMode;
  // ----- deprecated, retained so old localStorage payloads still load -----
  preferredPronouns?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  language?: string;
  showTimestamps?: boolean;
  theme?: ThemeColors;
};

export const DEFAULT_SETTINGS: Settings = {
  autoSpeak: false,
  voiceRate: 1,
  voiceName: "",
  displayName: "",
  email: "",
  extraFacts: "",
  customInstructions: "",
  mood: "neutral",
  responseLength: "medium",
  rememberAcross: true,
  webSearch: true,
  sendOnEnter: true,
  mode: "system",
  theme: DEFAULT_THEME,
};

const MOODS: { value: Mood; label: string; hint: string }[] = [
  { value: "neutral", label: "Neutral", hint: "Balanced and helpful" },
  { value: "friendly", label: "Friendly", hint: "Warm and approachable" },
  { value: "professional", label: "Professional", hint: "Polished and formal" },
  { value: "concise", label: "Concise", hint: "Short, direct answers" },
];

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onClearAll,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClearAll: () => void;
}) {
  const usage = open ? getUsage() : { images: 0, uploads: 0, date: "" };
  const [voices, setVoices] = useState(() => getVoices());
  const { isSignedIn, user } = useUser();
  const clerk = useClerk();
  const loggedIn = !clerkEnabled || isSignedIn;

  useEffect(() => {
    const unsub = onVoicesChanged(() => setVoices(getVoices()));
    return unsub;
  }, []);

  // Filter to English voices for cleaner UX
  const englishVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const list = englishVoices.length > 0 ? englishVoices : voices;
  const currentVoice = settings.voiceName || defaultVoiceName();

  const setMode = (m: ThemeMode) => {
    applyThemeMode(m);
    onChange({ ...settings, mode: m });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0 border border-border/60 shadow-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="text-xl font-semibold tracking-tight font-display">
            Settings
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {loggedIn
              ? "Changes save automatically."
              : "Sign in to view and change your settings."}
          </p>
        </DialogHeader>

        {!loggedIn ? (
          <div className="p-6">
            <LockedTab
              title="Sign in to access settings"
              body="Your preferences are tied to your KovaGPT account. Sign in or create a free account to continue."
              onSignIn={() => clerk?.openSignIn()}
            />
          </div>
        ) : (
        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="flex w-full overflow-x-auto justify-start gap-1 h-auto p-1 mx-6 mt-4 mb-2 max-w-[calc(100%-3rem)] bg-muted rounded-full">
            {[
              { v: "general", icon: Sparkles, label: "General" },
              { v: "you", icon: User2, label: "You" },
              { v: "appearance", icon: Palette, label: "Theme" },
              { v: "billing", icon: CreditCard, label: "Billing" },
              { v: "security", icon: ShieldCheck, label: "Account" },
            ].map(({ v, icon: Icon, label }) => (
              <TabsTrigger
                key={v}
                value={v}
                className="shrink-0 gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* GENERAL — voice, behavior, usage, data */}
          <TabsContent value="general" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Voice</h3>
              <ToggleRow
                title="Auto-read responses"
                hint="Speak replies out loud automatically."
                checked={settings.autoSpeak}
                onCheckedChange={(v) => onChange({ ...settings, autoSpeak: v })}
              />
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Voice</label>
                <div className="flex gap-2">
                  <Select
                    value={currentVoice}
                    onValueChange={(v) => onChange({ ...settings, voiceName: v })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a voice" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {list.map((v) => (
                        <SelectItem key={v.name} value={v.name}>
                          {friendlyVoiceLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() =>
                      speak("Hi, I'm KovaGPT. This is how I sound.", {
                        voice: currentVoice,
                        rate: settings.voiceRate,
                      })
                    }
                    title="Preview"
                  >
                    <Play className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">
                  Speech rate: {settings.voiceRate.toFixed(1)}x
                </div>
                <Slider
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={[settings.voiceRate]}
                  onValueChange={(v) => onChange({ ...settings, voiceRate: v[0] })}
                />
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Behavior</h3>
              <ToggleRow
                title="Live web search"
                hint="Fetch fresh results for time-sensitive questions."
                checked={settings.webSearch}
                onCheckedChange={(v) => onChange({ ...settings, webSearch: v })}
              />
              <ToggleRow
                title="Send on Enter"
                hint="Enter sends; Shift+Enter for a new line."
                checked={settings.sendOnEnter}
                onCheckedChange={(v) => onChange({ ...settings, sendOnEnter: v })}
              />
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Preferred response length
                </label>
                <Select
                  value={settings.responseLength}
                  onValueChange={(v) =>
                    onChange({ ...settings, responseLength: v as Settings["responseLength"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short — get to the point</SelectItem>
                    <SelectItem value="medium">Medium — balanced</SelectItem>
                    <SelectItem value="long">Long — detailed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Today's usage</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Images generated</span>
                  <span>{usage.images} / {DAILY_IMAGE_LIMIT}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Images uploaded</span>
                  <span>{usage.uploads} / {DAILY_UPLOAD_LIMIT}</span>
                </div>
              </div>
            </section>

            <section>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearConversations();
                  onClearAll();
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear all conversations
              </Button>
            </section>
          </TabsContent>

          {/* YOU — personalization */}
          <TabsContent value="you" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">About you</h3>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Preferred name</label>
                <Input
                  placeholder={user?.firstName || "Your name"}
                  value={settings.displayName}
                  onChange={(e) => onChange({ ...settings, displayName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Anything KovaGPT should know about you
                </label>
                <textarea
                  rows={4}
                  placeholder="e.g. I'm a student in Chicago. I prefer metric. I'm learning Python."
                  value={settings.extraFacts}
                  onChange={(e) => onChange({ ...settings, extraFacts: e.target.value })}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y min-h-[90px]"
                />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">How KovaGPT should respond</h3>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Tone</label>
                <Select
                  value={settings.mood}
                  onValueChange={(v) => onChange({ ...settings, mood: v as Mood })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <div className="flex flex-col">
                          <span>{m.label}</span>
                          <span className="text-xs text-muted-foreground">{m.hint}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Custom instructions
                </label>
                <textarea
                  rows={4}
                  placeholder="e.g. Answer in clear bullets. Use simple language. Skip disclaimers."
                  value={settings.customInstructions}
                  onChange={(e) => onChange({ ...settings, customInstructions: e.target.value })}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y min-h-[90px]"
                />
              </div>
              <ToggleRow
                title="Remember across conversations"
                hint="Carry your profile and instructions into every new chat."
                checked={settings.rememberAcross}
                onCheckedChange={(v) => onChange({ ...settings, rememberAcross: v })}
              />
            </section>
          </TabsContent>

          {/* APPEARANCE — light/dark mode toggle only */}
          <TabsContent value="appearance" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Appearance</h3>
              <p className="text-xs text-muted-foreground">
                Choose how KovaGPT looks. System follows your device.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: "light", label: "Light", Icon: Sun },
                  { v: "dark", label: "Dark", Icon: Moon },
                  { v: "system", label: "System", Icon: Monitor },
                ] as const).map(({ v, label, Icon }) => {
                  const active = (settings.mode ?? "system") === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setMode(v)}
                      className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-4 py-5 text-sm font-medium transition ${
                        active
                          ? "border-foreground bg-accent text-foreground shadow-sm"
                          : "border-border hover:bg-accent/60 text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          </TabsContent>

          {/* BILLING */}
          <TabsContent value="billing" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Current plan</div>
                <div className="text-xs text-muted-foreground mt-1">
                  You're on the Free plan. Upgrade for more usage and advanced modes.
                </div>
              </div>
              <Link
                to="/pricing"
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" /> Upgrade
              </Link>
            </div>
            <a
              href="https://billing.stripe.com/p/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent transition"
            >
              <ExternalLink className="w-4 h-4" /> Open billing portal
            </a>
            <p className="text-xs text-muted-foreground">
              Payments are securely handled by Stripe. We never see or store your card number.
            </p>
          </TabsContent>

          {/* ACCOUNT / SECURITY */}
          <TabsContent value="security" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <div className="rounded-lg border border-border p-4">
              <div className="text-sm font-medium">Signed in as</div>
              <div className="text-sm text-muted-foreground mt-1">
                {user?.primaryEmailAddress?.emailAddress ?? user?.firstName ?? "your account"}
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <SecurityRow
                title="Password & two-factor"
                body="Manage your password and turn on 2FA."
                actionLabel="Open account"
                onAction={() => clerk?.openUserProfile()}
              />
              <SecurityRow
                title="Sign out"
                body="Sign out of this device."
                actionLabel="Sign out"
                onAction={() => clerk?.signOut()}
              />
            </div>
          </TabsContent>
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}


function LockedTab({
  title,
  body,
  onSignIn,
}: {
  title: string;
  body: string;
  onSignIn?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl border border-dashed border-border bg-muted/30">
      <div className="w-12 h-12 rounded-full bg-foreground/10 flex items-center justify-center mb-4">
        <Lock className="w-5 h-5 text-foreground/70" />
      </div>
      <h3 className="text-base font-semibold mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-5">{body}</p>
      <Button size="sm" onClick={() => onSignIn?.()} className="rounded-full px-5">
        Log in or sign up
      </Button>
    </div>
  );
}


function SecurityRow({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-1">{body}</div>
      </div>
      <Button size="sm" variant="outline" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
