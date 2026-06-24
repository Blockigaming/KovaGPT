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
  Link2,
  Brain,
  Check,
  Mail,
  Bell,
  Baby,
  Mic,
  Database,
  HardDrive,
  Bug,
  LifeBuoy,
  Info,
  LogOut,
  RefreshCw,
  Settings as Cog,
} from "lucide-react";
import { useTier, tierRank } from "@/hooks/useTier";
import {
  ALL_LINKED_PROVIDERS,
  connectProvider,
  disconnectProvider,
  getLinkedAccounts,
  getProviderMeta,
  type LinkedProvider,
} from "@/lib/linked-accounts";
import { toast } from "sonner";
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
  autoSpeak: boolean;
  voiceRate: number;
  voiceName: string;
  displayName: string;
  email: string;
  extraFacts: string;
  customInstructions: string;
  mood: Mood;
  responseLength: "short" | "medium" | "long";
  rememberAcross: boolean;
  webSearch: boolean;
  sendOnEnter: boolean;
  mode: ThemeMode;
  // Notifications
  notifyEmail?: boolean;
  notifyProduct?: boolean;
  // Parental controls
  parentalMode?: boolean;
  // Data control
  trainingOptOut?: boolean;
  // deprecated fields kept so old localStorage payloads still load
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
  notifyEmail: true,
  notifyProduct: true,
  parentalMode: false,
  trainingOptOut: false,
  theme: DEFAULT_THEME,
};

const MOODS: { value: Mood; label: string; hint: string }[] = [
  { value: "neutral", label: "Neutral", hint: "Balanced and helpful" },
  { value: "friendly", label: "Friendly", hint: "Warm and approachable" },
  { value: "professional", label: "Professional", hint: "Polished and formal" },
  { value: "concise", label: "Concise", hint: "Short, direct answers" },
];

type TabDef = { v: string; label: string; icon: typeof Cog };

const TAB_ORDER: TabDef[] = [
  { v: "general", label: "General", icon: Cog },
  { v: "personalization", label: "Personalization", icon: User2 },
  { v: "memory", label: "Memory", icon: Brain },
  { v: "linked", label: "Linked apps", icon: Link2 },
  { v: "email", label: "Email", icon: Mail },
  { v: "subscription", label: "Subscription", icon: CreditCard },
  { v: "appearance", label: "Appearance", icon: Palette },
  { v: "notifications", label: "Notifications", icon: Bell },
  { v: "parental", label: "Parental controls", icon: Baby },
  { v: "voice", label: "Voice", icon: Mic },
  { v: "security", label: "Safety & security", icon: ShieldCheck },
  { v: "data", label: "Data control", icon: Database },
  { v: "storage", label: "Storage", icon: HardDrive },
  { v: "report", label: "Report an issue", icon: Bug },
  { v: "help", label: "Help center", icon: LifeBuoy },
  { v: "about", label: "About", icon: Info },
  { v: "logout", label: "Log out", icon: LogOut },
];

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onClearAll,
  initialTab,
  onOpenHelp,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClearAll: () => void;
  initialTab?: string;
  onOpenHelp?: () => void;
}) {
  const usage = open ? getUsage() : { images: 0, uploads: 0, date: "" };
  const [voices, setVoices] = useState(() => getVoices());
  const { isSignedIn, user } = useUser();
  const clerk = useClerk();
  const loggedIn = !clerkEnabled || isSignedIn;
  const { tier } = useTier();
  const adaptiveMemoryUnlocked = tierRank(tier) >= 1;
  const [linked, setLinked] = useState<LinkedProvider[]>(() =>
    user?.id ? getLinkedAccounts(user.id) : [],
  );
  const [tab, setTab] = useState<string>(initialTab ?? "general");

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    setLinked(user?.id ? getLinkedAccounts(user.id) : []);
  }, [open, user?.id]);

  useEffect(() => {
    const unsub = onVoicesChanged(() => setVoices(getVoices()));
    return unsub;
  }, []);

  const englishVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const list = englishVoices.length > 0 ? englishVoices : voices;
  const currentVoice = settings.voiceName || defaultVoiceName();

  const setMode = (m: ThemeMode) => {
    applyThemeMode(m);
    onChange({ ...settings, mode: m });
  };

  const handleLogout = async () => {
    try {
      await clerk?.signOut();
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't sign out. Try again.");
    }
  };

  const handleRestore = () => {
    toast.message("Checking for previous purchases...", {
      description: "If we find an active subscription on your account, it will be restored automatically.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0 border border-border/60 shadow-2xl">
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
        <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex-1 overflow-hidden flex flex-row">
          <TabsList className="flex flex-col h-full w-56 shrink-0 overflow-y-auto items-stretch justify-start gap-0.5 p-2 bg-muted/40 border-r border-border rounded-none">
            {TAB_ORDER.map(({ v, icon: Icon, label }) => (
              <TabsTrigger
                key={v}
                value={v}
                className="w-full justify-start gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate text-left">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-hidden flex flex-col">
          {/* GENERAL */}
          <TabsContent value="general" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
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
                    <SelectItem value="short">Short - get to the point</SelectItem>
                    <SelectItem value="medium">Medium - balanced</SelectItem>
                    <SelectItem value="long">Long - detailed</SelectItem>
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
          </TabsContent>

          {/* PERSONALIZATION */}
          <TabsContent value="personalization" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
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
            </section>
          </TabsContent>

          {/* MEMORY */}
          <TabsContent value="memory" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4" />
                <h3 className="text-sm font-semibold">Memory</h3>
              </div>
              <ToggleRow
                title="Remember across conversations"
                hint="Carry your profile and instructions into every new chat."
                checked={settings.rememberAcross}
                onCheckedChange={(v) => onChange({ ...settings, rememberAcross: v })}
              />
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <h3 className="text-sm font-semibold">Adaptive Memory</h3>
                <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground">
                  Plus
                </span>
              </div>
              {adaptiveMemoryUnlocked ? (
                <p className="text-xs text-muted-foreground">
                  Adaptive Memory is active. KovaGPT continually learns your preferences and adapts replies.
                </p>
              ) : (
                <div className="rounded-lg border border-border p-4 flex items-start gap-3">
                  <Lock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 text-sm">
                    <div className="font-medium">Available on Kova Plus and Pro</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Adaptive Memory remembers what matters to you across conversations.
                    </div>
                    <Link
                      to="/pricing"
                      onClick={() => onOpenChange(false)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium mt-3 px-3 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Upgrade to unlock
                    </Link>
                  </div>
                </div>
              )}
            </section>

            <section>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearConversations();
                  onClearAll();
                  toast.success("All conversation memory cleared.");
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear all conversations
              </Button>
            </section>
          </TabsContent>

          {/* LINKED APPS */}
          <TabsContent value="linked" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <section className="space-y-1">
              <h3 className="text-sm font-semibold">Linked apps</h3>
              <p className="text-xs text-muted-foreground">
                Connect external accounts so KovaGPT can use them in your chats. You can disconnect any time.
              </p>
            </section>
            <div className="space-y-2">
              {ALL_LINKED_PROVIDERS.map((p) => {
                const meta = getProviderMeta(p);
                const connected = linked.includes(p);
                return (
                  <div
                    key={p}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ProviderIcon provider={p} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{meta.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{meta.description}</div>
                      </div>
                    </div>
                    {connected ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center gap-1 text-xs text-foreground">
                          <Check className="w-3.5 h-3.5" /> Connected
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            if (!user?.id) return;
                            disconnectProvider(user.id, p);
                            setLinked(getLinkedAccounts(user.id));
                            toast.success(`${meta.label} disconnected.`);
                          }}
                        >
                          Disconnect
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={async () => {
                          if (!user?.id) return;
                          const res = await connectProvider(user.id, p);
                          if (res.error) {
                            toast.error(res.error);
                            return;
                          }
                          setLinked(getLinkedAccounts(user.id));
                          if (!res.redirected) toast.success(`${meta.label} connected.`);
                        }}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* EMAIL */}
          <TabsContent value="email" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <h3 className="text-sm font-semibold">Email address</h3>
            <div className="rounded-lg border border-border p-4">
              <div className="text-sm font-medium">Primary email</div>
              <div className="text-sm text-muted-foreground mt-1">
                {user?.primaryEmailAddress?.emailAddress ?? "No email on file"}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => clerk?.openUserProfile()}>
              <ExternalLink className="w-4 h-4 mr-2" />
              Manage email addresses
            </Button>
            <p className="text-xs text-muted-foreground">
              Verification emails are sent here when you sign in or create an account.
            </p>
          </TabsContent>

          {/* SUBSCRIPTION */}
          <TabsContent value="subscription" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Current plan</div>
                <div className="text-xs text-muted-foreground mt-1">
                  You're on the {tier === "free" ? "Free" : tier === "plus" ? "Plus" : "Pro"} plan.
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
            <div className="flex flex-wrap gap-2">
              <a
                href="https://billing.stripe.com/p/login"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent transition"
              >
                <ExternalLink className="w-4 h-4" /> Open billing portal
              </a>
              <Button variant="outline" size="sm" onClick={handleRestore}>
                <RefreshCw className="w-4 h-4 mr-2" /> Restore purchases
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Payments are securely handled by Stripe. We never see or store your card number.
            </p>
          </TabsContent>

          {/* APPEARANCE */}
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

          {/* NOTIFICATIONS */}
          <TabsContent value="notifications" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
            <h3 className="text-sm font-semibold">Notifications</h3>
            <ToggleRow
              title="Account & security emails"
              hint="Sign-in alerts, verification, and important account changes. Cannot be turned off for security."
              checked={true}
              onCheckedChange={() => toast.message("Security emails are always on.")}
            />
            <ToggleRow
              title="Product updates"
              hint="Occasional emails about new features and improvements."
              checked={settings.notifyProduct ?? true}
              onCheckedChange={(v) => onChange({ ...settings, notifyProduct: v })}
            />
            <ToggleRow
              title="Tips & guides"
              hint="Helpful tips on getting more out of KovaGPT."
              checked={settings.notifyEmail ?? true}
              onCheckedChange={(v) => onChange({ ...settings, notifyEmail: v })}
            />
          </TabsContent>

          {/* PARENTAL */}
          <TabsContent value="parental" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <h3 className="text-sm font-semibold">Parental controls</h3>
            <ToggleRow
              title="Family-safe mode"
              hint="Filters mature content and enforces stricter safety guidelines."
              checked={settings.parentalMode ?? false}
              onCheckedChange={(v) => onChange({ ...settings, parentalMode: v })}
            />
            <p className="text-xs text-muted-foreground">
              For full account-level parental controls (screen time, app restrictions), use your device's built-in settings.
            </p>
          </TabsContent>

          {/* VOICE */}
          <TabsContent value="voice" className="overflow-y-auto px-6 pb-6 space-y-6 py-4">
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
          </TabsContent>

          {/* SAFETY & SECURITY */}
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
                title="Active sessions"
                body="See devices currently signed into your account."
                actionLabel="Manage"
                onAction={() => clerk?.openUserProfile()}
              />
            </div>
          </TabsContent>

          {/* DATA CONTROL */}
          <TabsContent value="data" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <h3 className="text-sm font-semibold">Data controls</h3>
            <ToggleRow
              title="Improve the model for everyone"
              hint="Allow KovaGPT to use your conversations to improve quality. Turn off to opt out."
              checked={!(settings.trainingOptOut ?? false)}
              onCheckedChange={(v) => onChange({ ...settings, trainingOptOut: !v })}
            />
            <SecurityRow
              title="Export your data"
              body="Download a copy of your account data."
              actionLabel="Request export"
              onAction={() => toast.message("Export request received. We'll email you when it's ready.")}
            />
            <SecurityRow
              title="Delete account"
              body="Permanently delete your account and all data."
              actionLabel="Delete"
              onAction={() => clerk?.openUserProfile()}
            />
          </TabsContent>

          {/* STORAGE */}
          <TabsContent value="storage" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <h3 className="text-sm font-semibold">Storage</h3>
            <p className="text-xs text-muted-foreground">
              Conversations and preferences are stored locally on this device and synced to your account.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearConversations();
                onClearAll();
                toast.success("Local storage cleared.");
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear local storage
            </Button>
          </TabsContent>

          {/* REPORT ISSUE */}
          <TabsContent value="report" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <h3 className="text-sm font-semibold">Report an issue</h3>
            <p className="text-xs text-muted-foreground">
              Found a bug or something off? Send it to our team and we'll take a look.
            </p>
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onOpenHelp?.();
              }}
            >
              <Bug className="w-4 h-4 mr-2" />
              Open bug report form
            </Button>
          </TabsContent>

          {/* HELP CENTER */}
          <TabsContent value="help" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <h3 className="text-sm font-semibold">Help center</h3>
            <p className="text-xs text-muted-foreground">
              Get help, contact support, or browse common questions.
            </p>
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onOpenHelp?.();
              }}
            >
              <LifeBuoy className="w-4 h-4 mr-2" />
              Open help center
            </Button>
          </TabsContent>

          {/* ABOUT */}
          <TabsContent value="about" className="overflow-y-auto px-6 pb-6 space-y-3 py-4">
            <h3 className="text-sm font-semibold">About KovaGPT</h3>
            <p className="text-sm text-muted-foreground">
              KovaGPT is built by Zachary Block. Our mission is to make a helpful, kind, and trustworthy AI available to everyone.
            </p>
            <div className="text-xs text-muted-foreground space-y-1 pt-2">
              <div>Version 1.0</div>
              <div>
                <Link to="/privacy" onClick={() => onOpenChange(false)} className="underline">
                  Privacy policy
                </Link>
                {" • "}
                <Link to="/terms" onClick={() => onOpenChange(false)} className="underline">
                  Terms of service
                </Link>
              </div>
            </div>
          </TabsContent>

          {/* LOG OUT */}
          <TabsContent value="logout" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            <h3 className="text-sm font-semibold">Log out</h3>
            <p className="text-sm text-muted-foreground">
              You'll be signed out of KovaGPT on this device.
            </p>
            <Button variant="destructive" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Log out
            </Button>
          </TabsContent>
          </div>
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}


function ProviderIcon({ provider }: { provider: LinkedProvider }) {
  const base = "w-9 h-9 rounded-lg flex items-center justify-center shrink-0";
  if (provider === "apple") {
    return (
      <div className={base + " bg-foreground text-background"}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M16.365 1.43c0 1.14-.456 2.227-1.197 3.02-.79.85-2.07 1.51-3.12 1.43-.13-1.1.43-2.26 1.16-3.04.82-.88 2.2-1.54 3.16-1.4zM20.5 17.27c-.55 1.27-.82 1.84-1.53 2.97-.99 1.57-2.39 3.53-4.12 3.55-1.54.01-1.94-1-4.04-1-2.1.01-2.54 1.02-4.08 1-1.73-.02-3.06-1.78-4.05-3.35C-.06 16.66-.34 11.5 2.27 8.84c1.42-1.44 3.44-2.27 5.36-2.27 1.94 0 3.16 1.07 4.76 1.07 1.55 0 2.5-1.07 4.74-1.07 1.71 0 3.52.93 4.81 2.54-4.23 2.32-3.54 8.37 1.06 9.18z" />
        </svg>
      </div>
    );
  }
  if (provider === "youtube") {
    return (
      <div className={base + " bg-[#FF0000] text-white"}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
          <path d="M23.5 6.2a3.02 3.02 0 0 0-2.13-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.37.56A3.02 3.02 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3.02 3.02 0 0 0 2.13 2.14C4.5 20.5 12 20.5 12 20.5s7.5 0 9.37-.56a3.02 3.02 0 0 0 2.13-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z" />
        </svg>
      </div>
    );
  }
  if (provider === "gmail") {
    return (
      <div className={base + " bg-white border border-border"}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
          <path fill="#EA4335" d="M12 13.065L1.5 5.4V18a1.5 1.5 0 0 0 1.5 1.5h3V11l6 4.5 6-4.5v8.5h3a1.5 1.5 0 0 0 1.5-1.5V5.4L12 13.065z" />
          <path fill="#4285F4" d="M22.5 5.4V18a1.5 1.5 0 0 1-1.5 1.5h-3V11l-6 4.5V13l10.5-7.6z" />
          <path fill="#34A853" d="M1.5 5.4V18a1.5 1.5 0 0 0 1.5 1.5h3V11L1.5 5.4z" />
          <path fill="#FBBC05" d="M22.5 5.4L12 13.065 1.5 5.4l10.5 7.6 10.5-7.6z" />
        </svg>
      </div>
    );
  }
  if (provider === "google-drive") {
    return (
      <div className={base + " bg-white border border-border"}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
          <path fill="#0F9D58" d="M7.71 21l4.29-7.43L7.7 6.14h8.6L20.6 13.57 16.29 21H7.71z" />
          <path fill="#F4B400" d="M2 13.57L7.71 21h8.58L10.57 11l-4.28-7.43L2 13.57z" opacity=".85" />
          <path fill="#4285F4" d="M22 13.57L16.29 21H7.71L13.43 11l4.28-7.43L22 13.57z" opacity=".7" />
        </svg>
      </div>
    );
  }
  return (
    <div className={base + " bg-white border border-border"}>
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
      </svg>
    </div>
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
