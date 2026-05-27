import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Trash2, Play, Palette, User2, ShieldCheck, Sparkles, MessageSquare, CreditCard, Globe2, ExternalLink, Lock } from "lucide-react";
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
import { applyThemeColors, DEFAULT_THEME, type ThemeColors } from "@/lib/theme";

export type Mood =
  | "neutral"
  | "friendly"
  | "professional"
  | "playful"
  | "concise"
  | "encouraging"
  | "witty";

export type Settings = {
  // Voice
  autoSpeak: boolean;
  voiceRate: number;
  voiceName: string;
  // Personalization
  displayName: string;
  preferredPronouns: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  extraFacts: string;
  customInstructions: string;
  mood: Mood;
  responseLength: "short" | "medium" | "long";
  language: string;
  rememberAcross: boolean;
  // Behavior
  webSearch: boolean;
  sendOnEnter: boolean;
  showTimestamps: boolean;
  // Appearance
  theme: ThemeColors;
};

export const DEFAULT_SETTINGS: Settings = {
  autoSpeak: false,
  voiceRate: 1,
  voiceName: "",
  displayName: "",
  preferredPronouns: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  extraFacts: "",
  customInstructions: "",
  mood: "neutral",
  responseLength: "medium",
  language: "auto",
  rememberAcross: true,
  webSearch: false,
  sendOnEnter: true,
  showTimestamps: false,
  theme: DEFAULT_THEME,
};

const MOODS: { value: Mood; label: string; hint: string }[] = [
  { value: "neutral", label: "Neutral", hint: "Balanced and helpful" },
  { value: "friendly", label: "Friendly", hint: "Warm and approachable" },
  { value: "professional", label: "Professional", hint: "Polished and formal" },
  { value: "playful", label: "Playful", hint: "Light, fun, casual" },
  { value: "concise", label: "Concise", hint: "Short, direct answers" },
  { value: "encouraging", label: "Encouraging", hint: "Motivating, supportive" },
  { value: "witty", label: "Witty", hint: "Clever and a little cheeky" },
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

  const updateTheme = (patch: Partial<ThemeColors>) => {
    const next = { ...settings.theme, ...patch };
    applyThemeColors(next);
    onChange({ ...settings, theme: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="text-lg">Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="flex w-full overflow-x-auto justify-start gap-1 h-auto p-1.5 mx-6 mt-4 mb-2 max-w-[calc(100%-3rem)]">
            <TabsTrigger value="general" className="shrink-0 gap-1.5"><Sparkles className="w-4 h-4 hidden sm:inline" />General</TabsTrigger>
            <TabsTrigger value="personalization" className="shrink-0 gap-1.5"><User2 className="w-4 h-4 hidden sm:inline" />You {!loggedIn && <Lock className="w-3 h-3 opacity-60" />}</TabsTrigger>
            <TabsTrigger value="behavior" className="shrink-0 gap-1.5"><MessageSquare className="w-4 h-4 hidden sm:inline" />Behavior {!loggedIn && <Lock className="w-3 h-3 opacity-60" />}</TabsTrigger>
            <TabsTrigger value="appearance" className="shrink-0 gap-1.5"><Palette className="w-4 h-4 hidden sm:inline" />Appearance {!loggedIn && <Lock className="w-3 h-3 opacity-60" />}</TabsTrigger>
            <TabsTrigger value="billing" className="shrink-0 gap-1.5"><CreditCard className="w-4 h-4 hidden sm:inline" />Billing {!loggedIn && <Lock className="w-3 h-3 opacity-60" />}</TabsTrigger>
            <TabsTrigger value="security" className="shrink-0 gap-1.5"><ShieldCheck className="w-4 h-4 hidden sm:inline" />Security {!loggedIn && <Lock className="w-3 h-3 opacity-60" />}</TabsTrigger>
          </TabsList>


          {/* GENERAL — voice + usage + data */}
          <TabsContent value="general" className="overflow-y-auto pr-1 space-y-6 py-4">
            <section>
              <h3 className="text-sm font-semibold mb-3">Voice</h3>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">Auto-read responses</div>
                  <div className="text-xs text-muted-foreground">Speak replies out loud automatically</div>
                </div>
                <Switch
                  checked={settings.autoSpeak}
                  onCheckedChange={(v) => onChange({ ...settings, autoSpeak: v })}
                />
              </div>

              <div className="mt-4">
                <label className="text-sm mb-2 block">Voice</label>
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
                      speak("Hi, I'm NovaGPT. This is how I sound.", {
                        voice: currentVoice,
                        rate: settings.voiceRate,
                      })
                    }
                    title="Preview"
                  >
                    <Play className="w-4 h-4" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Default tries an Adam-like deep male voice (Daniel / Google UK Male).
                </div>
              </div>

              <div className="mt-4">
                <div className="text-sm mb-2">Speech rate: {settings.voiceRate.toFixed(1)}x</div>
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
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Globe2 className="w-4 h-4" /> Knowledge & input
              </h3>

              <ToggleRow
                title="Live web search"
                hint="Fetch fresh results from the web for time-sensitive questions so answers stay up to date."
                checked={settings.webSearch}
                onCheckedChange={(v) => onChange({ ...settings, webSearch: v })}
              />
              <ToggleRow
                title="Send on Enter"
                hint="Enter sends. Shift + Enter for a new line. Turn off to require the send button."
                checked={settings.sendOnEnter}
                onCheckedChange={(v) => onChange({ ...settings, sendOnEnter: v })}
              />
              <ToggleRow
                title="Show timestamps"
                hint="Display a small timestamp under each message."
                checked={settings.showTimestamps}
                onCheckedChange={(v) => onChange({ ...settings, showTimestamps: v })}
              />

              <div>
                <label className="text-sm mb-2 block">Preferred response length</label>
                <Select
                  value={settings.responseLength}
                  onValueChange={(v) => onChange({ ...settings, responseLength: v as Settings["responseLength"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short — get to the point</SelectItem>
                    <SelectItem value="medium">Medium — balanced (default)</SelectItem>
                    <SelectItem value="long">Long — detailed, thorough</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm mb-2 block">Response language</label>
                <Select
                  value={settings.language}
                  onValueChange={(v) => onChange({ ...settings, language: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (match my message)</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="pt">Português</SelectItem>
                    <SelectItem value="it">Italiano</SelectItem>
                    <SelectItem value="nl">Nederlands</SelectItem>
                    <SelectItem value="zh">中文</SelectItem>
                    <SelectItem value="ja">日本語</SelectItem>
                    <SelectItem value="ko">한국어</SelectItem>
                    <SelectItem value="ar">العربية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>


            <section>
              <h3 className="text-sm font-semibold mb-3">Daily Usage (Free)</h3>
              <div className="space-y-2 text-sm">
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
              <h3 className="text-sm font-semibold mb-3">Data</h3>
              <Button
                variant="destructive"
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

          {/* PERSONALIZATION — only useful when signed in */}
          <TabsContent value="personalization" className="overflow-y-auto pr-1 space-y-5 py-4">
            {!loggedIn && (
              <p className="text-sm text-muted-foreground">
                Sign in to save personalization across devices. Settings are stored locally for now.
              </p>
            )}

            <section className="space-y-4">
              <h3 className="text-sm font-semibold">How to address you</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Preferred name</label>
                  <Input
                    placeholder={user?.firstName || "Your name"}
                    value={settings.displayName}
                    onChange={(e) => onChange({ ...settings, displayName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Pronouns</label>
                  <Input
                    placeholder="e.g. she/her, he/him, they/them"
                    value={settings.preferredPronouns}
                    onChange={(e) => onChange({ ...settings, preferredPronouns: e.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Contact</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                  <Input
                    type="email"
                    placeholder={user?.primaryEmailAddress?.emailAddress || "you@example.com"}
                    value={settings.email}
                    onChange={(e) => onChange({ ...settings, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
                  <Input
                    type="tel"
                    placeholder="+1 555 123 4567"
                    value={settings.phone}
                    onChange={(e) => onChange({ ...settings, phone: e.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Address</h3>
              <Input
                placeholder="Address line 1"
                value={settings.addressLine1}
                onChange={(e) => onChange({ ...settings, addressLine1: e.target.value })}
              />
              <Input
                placeholder="Address line 2 (optional)"
                value={settings.addressLine2}
                onChange={(e) => onChange({ ...settings, addressLine2: e.target.value })}
              />
              <div className="grid sm:grid-cols-3 gap-3">
                <Input
                  placeholder="City"
                  value={settings.city}
                  onChange={(e) => onChange({ ...settings, city: e.target.value })}
                />
                <Input
                  placeholder="State / Region"
                  value={settings.region}
                  onChange={(e) => onChange({ ...settings, region: e.target.value })}
                />
                <Input
                  placeholder="Postal code"
                  value={settings.postalCode}
                  onChange={(e) => onChange({ ...settings, postalCode: e.target.value })}
                />
              </div>
              <Input
                placeholder="Country"
                value={settings.country}
                onChange={(e) => onChange({ ...settings, country: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Used for billing receipts and to format addresses or local info correctly.
              </p>
            </section>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Extra facts about you</label>
              <textarea
                rows={4}
                placeholder="e.g. I'm a high school student in Chicago. I prefer answers in metric. I'm learning Python."
                value={settings.extraFacts}
                onChange={(e) => onChange({ ...settings, extraFacts: e.target.value })}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y min-h-[100px]"
              />
            </div>

            <ToggleRow
              title="Remember across conversations"
              hint="Let NovaGPT carry your profile, custom instructions, and a short summary of past chats into every new conversation."
              checked={settings.rememberAcross}
              onCheckedChange={(v) => onChange({ ...settings, rememberAcross: v })}
            />

          </TabsContent>

          {/* BEHAVIOR — how it should respond */}
          <TabsContent value="behavior" className="overflow-y-auto pr-1 space-y-5 py-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Mood</label>
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
              <label className="text-sm font-medium mb-1.5 block">How should NovaGPT respond?</label>
              <textarea
                rows={5}
                placeholder="e.g. Always answer in clear bullet points. Use simple language. Show code in TypeScript when possible. Skip disclaimers."
                value={settings.customInstructions}
                onChange={(e) => onChange({ ...settings, customInstructions: e.target.value })}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y min-h-[120px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Applied to every response.
              </p>
            </div>
          </TabsContent>

          {/* APPEARANCE — color customization */}
          <TabsContent value="appearance" className="overflow-y-auto pr-1 space-y-5 py-4">
            <p className="text-sm text-muted-foreground">
              Customize app colors. Changes apply instantly and are saved to this device.
            </p>

            <ColorRow
              label="Background"
              value={settings.theme.background}
              onChange={(v) => updateTheme({ background: v })}
            />
            <ColorRow
              label="Card / Surface"
              value={settings.theme.card}
              onChange={(v) => updateTheme({ card: v })}
            />
            <ColorRow
              label="Primary (Send button, accents)"
              value={settings.theme.primary}
              onChange={(v) => updateTheme({ primary: v })}
            />
            <ColorRow
              label="Primary text"
              value={settings.theme.primaryForeground}
              onChange={(v) => updateTheme({ primaryForeground: v })}
            />
            <ColorRow
              label="Accent / Hover"
              value={settings.theme.accent}
              onChange={(v) => updateTheme({ accent: v })}
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => updateTheme(DEFAULT_THEME)}
            >
              Reset to defaults
            </Button>
          </TabsContent>

          {/* BILLING */}
          <TabsContent value="billing" className="overflow-y-auto pr-1 space-y-5 py-4">
            <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Current plan</div>
                <div className="text-xs text-muted-foreground mt-1">
                  You're on the Free plan. Upgrade for unlimited image generation, faster responses, and priority support.
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

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Payment method</h3>
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No card on file. Add a card when you upgrade — payments are
                securely handled by Stripe. We never see or store your card number.
              </div>
              <Link
                to="/pricing"
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent transition"
              >
                <CreditCard className="w-4 h-4" /> Add a payment method
              </Link>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Billing address</h3>
              <p className="text-xs text-muted-foreground">
                Used on receipts and invoices. Edit in <strong>You → Address</strong>.
              </p>
              <div className="rounded-lg border border-border p-4 text-sm space-y-0.5">
                <div>{settings.displayName || "—"}</div>
                <div>{settings.addressLine1 || <span className="text-muted-foreground">No street address</span>}</div>
                {settings.addressLine2 && <div>{settings.addressLine2}</div>}
                <div className="text-muted-foreground">
                  {[settings.city, settings.region, settings.postalCode].filter(Boolean).join(", ") || "—"}
                </div>
                <div className="text-muted-foreground">{settings.country || ""}</div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Receipts & invoices</h3>
              <p className="text-xs text-muted-foreground">
                After upgrading, receipts are emailed automatically and available
                in the Stripe customer portal.
              </p>
              <a
                href="https://billing.stripe.com/p/login"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent transition"
              >
                <ExternalLink className="w-4 h-4" /> Open billing portal
              </a>
            </section>
          </TabsContent>

          {/* SECURITY */}
          <TabsContent value="security" className="overflow-y-auto pr-1 space-y-5 py-4">

            {loggedIn ? (
              <>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-sm font-medium">Signed in as</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {user?.primaryEmailAddress?.emailAddress ?? user?.firstName ?? "your account"}
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <SecurityRow
                    title="Password & two-factor"
                    body="Manage your password and turn on 2FA from your account page."
                    actionLabel="Open account"
                    onAction={() => clerk?.openUserProfile()}
                  />
                  <SecurityRow
                    title="Active sessions"
                    body="Sign out of every device, or just this one."
                    actionLabel="Sign out"
                    onAction={() => clerk?.signOut()}
                  />
                </div>

                <div className="text-xs text-muted-foreground">
                  Authentication and email security are handled by our authentication provider.
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sign in to manage your account, password, and active sessions.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-9 rounded-md border border-border bg-transparent cursor-pointer"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 font-mono text-xs"
        />
      </div>
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
