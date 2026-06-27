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
  FolderOpen,
  Wallet,
  Settings as Cog,
} from "lucide-react";
import { useTier, tierRank } from "@/hooks/useTier";
import {
  connectProvider,
  disconnectProvider,
  getLinkedAccounts,
  type LinkedProvider,
} from "@/lib/linked-accounts";
import {
  CONNECTOR_CATALOG,
  CONNECTOR_CATEGORIES,
  type ConnectorItem,
} from "@/lib/connectors-catalog";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getMyDailyUsage, type DailyUsageDto } from "@/utils/usage.functions";
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

// Library lives in the left sidebar as a primary nav item. Finances is removed
// from Settings entirely per product spec. Keeping a single flat list keeps the
// sidebar readable without grouping headers (deferred to a future polish pass).
const TAB_ORDER: TabDef[] = [
  { v: "general", label: "General", icon: Cog },
  { v: "personalization", label: "Personalization", icon: User2 },
  { v: "memory", label: "Memory", icon: Brain },
  { v: "linked", label: "Apps", icon: Link2 },
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

// Limited tabs shown to signed-out users (privacy preferences + appearance + language).
const SIGNED_OUT_TABS: TabDef[] = [
  { v: "appearance", label: "Appearance", icon: Palette },
  { v: "data", label: "Privacy & data", icon: Database },
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
  const localUsage = open ? getUsage() : { images: 0, uploads: 0, date: "" };
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
  const [usage, setUsage] = useState<DailyUsageDto | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    if (!open || tab !== "subscription" || !loggedIn) return;
    let cancelled = false;
    setUsageLoading(true);
    getMyDailyUsage()
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, loggedIn]);

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
          <SignedOutSettings
            settings={settings}
            onChange={onChange}
            setMode={setMode}
            onSignIn={() => clerk?.openSignIn()}
          />
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
                  <span>{localUsage.images} / {DAILY_IMAGE_LIMIT}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Images uploaded</span>
                  <span>{localUsage.uploads} / {DAILY_UPLOAD_LIMIT}</span>
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

          <TabsContent value="linked" className="overflow-y-auto px-6 pb-6 space-y-5 py-4">
            {!loggedIn ? (
              <SignInGate label="Apps" />
            ) : (
              <>
            <section className="space-y-1">
              <h3 className="text-sm font-semibold">Apps</h3>
              <p className="text-xs text-muted-foreground">
                Connect external accounts so KovaGPT can use them in your chats. Live integrations work today; others are on the roadmap.
              </p>
              {tier === "free" && (
                <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">
                  Linked apps are a Plus feature. Upgrade to connect external accounts.
                </p>
              )}
            </section>

            {CONNECTOR_CATEGORIES.map((cat) => {
              const items = CONNECTOR_CATALOG.filter((c) => c.category === cat);
              if (items.length === 0) return null;
              return (
                <section key={cat} className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat}
                  </h4>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <ConnectorRow
                        key={item.id}
                        item={item}
                        linked={linked}
                        canConnect={tier !== "free"}
                        onConnect={async (p) => {
                          if (!user?.id) return;
                          const res = await connectProvider(user.id, p);
                          if (res.error) {
                            toast.error(res.error);
                            return;
                          }
                          setLinked(getLinkedAccounts(user.id));
                          if (!res.redirected) toast.success(`Connected.`);
                        }}
                        onDisconnect={(p) => {
                          if (!user?.id) return;
                          disconnectProvider(user.id, p);
                          setLinked(getLinkedAccounts(user.id));
                          toast.success(`Disconnected.`);
                        }}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
              </>
            )}
          </TabsContent>

          {/* LIBRARY */}
          <TabsContent value="library" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            {!loggedIn ? (
              <SignInGate label="Library" />
            ) : (
              <LibraryPanel />
            )}
          </TabsContent>

          {/* FINANCES */}
          <TabsContent value="finances" className="overflow-y-auto px-6 pb-6 space-y-4 py-4">
            {!loggedIn ? (
              <SignInGate label="Finances" />
            ) : (
              <FinancesPanel />
            )}
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

            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Usage today</div>
                {usage && (
                  <span className="text-[11px] text-muted-foreground">
                    Resets {new Date(usage.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                )}
              </div>
              {!loggedIn ? (
                <p className="text-xs text-muted-foreground">Sign in to see your usage.</p>
              ) : usageLoading && !usage ? (
                <p className="text-xs text-muted-foreground">Loading usage…</p>
              ) : usage ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Messages used</span>
                    <span>{usage.chats}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Images used</span>
                    <span>{usage.images}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">File uploads used</span>
                    <span>{usage.uploads}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Usage data isn't available right now. If you need help understanding your limits, contact{" "}
                  <a href="mailto:support@kovagpt.com" className="underline hover:text-foreground">support@kovagpt.com</a>.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href="https://billing.stripe.com/p/login"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-accent transition"
              >
                <ExternalLink className="w-4 h-4" /> Manage subscription / billing portal
              </a>
              <Button variant="outline" size="sm" onClick={handleRestore}>
                <RefreshCw className="w-4 h-4 mr-2" /> Restore purchases
              </Button>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="text-sm font-medium">Cancel subscription</div>
              <p className="text-xs text-muted-foreground">
                You can cancel anytime from the billing portal above. After canceling, you'll keep access to your current plan until the end of the billing period.
              </p>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="text-sm font-medium">Account and data deletion</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                If you want to delete your KovaGPT account or request deletion of your data, contact{" "}
                <a href="mailto:support@kovagpt.com" className="underline hover:text-foreground">support@kovagpt.com</a>{" "}
                from the email connected to your account. Please include "Account Deletion Request" in the subject line.
                After receiving your request, we may ask for confirmation to make sure the request is coming from the correct account owner.
              </p>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground pt-1">
              <Link to="/getting-started" onClick={() => onOpenChange(false)} className="underline hover:text-foreground">Getting started</Link>
              <Link to="/contact-support" onClick={() => onOpenChange(false)} className="underline hover:text-foreground">Contact support</Link>
              <Link to="/privacy" onClick={() => onOpenChange(false)} className="underline hover:text-foreground">Privacy policy</Link>
              <Link to="/terms" onClick={() => onOpenChange(false)} className="underline hover:text-foreground">Terms of service</Link>
              <Link to="/refund" onClick={() => onOpenChange(false)} className="underline hover:text-foreground">Refund policy</Link>
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

function SignInGate({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      <Lock className="w-5 h-5 mx-auto mb-2 opacity-60" />
      Sign in to use {label}.
    </div>
  );
}

function ConnectorRow({
  item,
  linked,
  canConnect,
  onConnect,
  onDisconnect,
}: {
  item: ConnectorItem;
  linked: LinkedProvider[];
  canConnect: boolean;
  onConnect: (p: LinkedProvider) => void;
  onDisconnect: (p: LinkedProvider) => void;
}) {
  const isLive = item.status === "live" && !!item.legacyProvider;
  const connected = isLive && linked.includes(item.legacyProvider as LinkedProvider);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-muted text-foreground flex items-center justify-center text-xs font-semibold shrink-0">
          {item.label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            {item.label}
            {item.status === "coming-soon" && (
              <span className="text-[10px] uppercase tracking-wider rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                Coming soon
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">{item.description}</div>
        </div>
      </div>
      {!isLive ? (
        <Button variant="outline" size="sm" className="h-8 shrink-0" disabled>
          Notify me
        </Button>
      ) : connected ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-xs text-foreground">
            <Check className="w-3.5 h-3.5" /> Connected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onDisconnect(item.legacyProvider as LinkedProvider)}
          >
            Disconnect
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          disabled={!canConnect}
          onClick={() => onConnect(item.legacyProvider as LinkedProvider)}
        >
          Connect
        </Button>
      )}
    </div>
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

type LibItem = import("@/lib/library.functions").LibraryItem;

function LibraryItemViewer({
  item,
  onClose,
  onDelete,
}: {
  item: LibItem | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  useEffect(() => {
    setImgUrl(null);
    setImgErr(null);
    if (!item || item.item_type !== "image") return;
    (async () => {
      try {
        const { getLibraryImageUrl } = await import("@/lib/library-images.functions");
        const { url } = await getLibraryImageUrl({ data: { id: item.id } });
        setImgUrl(url);
      } catch (e) {
        setImgErr(e instanceof Error ? e.message : "Could not load image");
      }
    })();
  }, [item?.id]);

  const isImage = item?.item_type === "image";
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-base truncate">{item?.title ?? ""}</DialogTitle>
          <div className="text-[11px] text-muted-foreground">
            {item ? `${item.item_type} · ${new Date(item.created_at).toLocaleString()}` : ""}
          </div>
        </DialogHeader>
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {isImage ? (
            imgErr ? (
              <div className="text-sm text-destructive">{imgErr}</div>
            ) : imgUrl ? (
              <img src={imgUrl} alt={item?.title ?? ""} className="max-h-[55vh] mx-auto rounded-lg" />
            ) : (
              <div className="text-sm text-muted-foreground">Loading image…</div>
            )
          ) : item?.content_text ? (
            <pre className="whitespace-pre-wrap text-sm font-sans">{item.content_text}</pre>
          ) : (
            <div className="text-sm text-muted-foreground">No text content for this item.</div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (isImage && imgUrl) {
                await navigator.clipboard.writeText(imgUrl);
                toast.success("Short-lived link copied (expires in ~1 min).");
                return;
              }
              if (!item?.content_text) return;
              await navigator.clipboard.writeText(item.content_text);
              toast.success("Copied.");
            }}
            disabled={isImage ? !imgUrl : !item?.content_text}
          >
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (item) onDelete(item.id);
            }}
          >
            Delete
          </Button>
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LibraryPanel() {
  const [items, setItems] = useState<LibItem[]>([]);
  const [shared, setShared] = useState<import("@/lib/shared-chats.functions").SharedChatInbox[]>([]);
  const [mine, setMine] = useState<import("@/lib/shared-chats.functions").SharedChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewing, setViewing] = useState<LibItem | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [lib, inbox, mineShares] = await Promise.all([
        (await import("@/lib/library.functions")).listMyLibrary(),
        (await import("@/lib/shared-chats.functions")).listSharedWithMe(),
        (await import("@/lib/shared-chats.functions")).listMySharedChats(),
      ]);
      setItems(lib);
      setShared(inbox);
      setMine(mineShares);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    try {
      const { deleteLibraryItem } = await import("@/lib/library.functions");
      await deleteLibraryItem({ data: { id } });
      setItems((prev) => prev.filter((i) => i.id !== id));
      setViewing((v) => (v?.id === id ? null : v));
      toast.success("Deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  const revoke = async (id: string) => {
    try {
      const { revokeSharedChat } = await import("@/lib/shared-chats.functions");
      await revokeSharedChat({ data: { id } });
      setMine((prev) => prev.map((m) => (m.id === id ? { ...m, status: "revoked" } : m)));
      toast.success("Share revoked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke.");
    }
  };

  const filtered = items.filter((it) => {
    if (typeFilter !== "all") {
      if (typeFilter === "chat" && !(it.item_type === "chat_artifact")) return false;
      if (typeFilter === "document" && it.item_type !== "document") return false;
      if (typeFilter === "code" && it.item_type !== "code") return false;
      if (typeFilter === "image" && it.item_type !== "image") return false;
      if (typeFilter === "other" && ["chat_artifact","document","code","image"].includes(it.item_type)) return false;
    }
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      it.title.toLowerCase().includes(q) ||
      (it.content_text ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">My library</h3>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Your saved files, drafts, and generated items will appear here.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or content..."
            className="h-8 text-xs"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 text-xs sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="chat">Chat artifacts</SelectItem>
              <SelectItem value="document">Documents</SelectItem>
              <SelectItem value="code">Code</SelectItem>
              <SelectItem value="image">Images</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : items.length === 0
                ? "Nothing saved yet. Use the Save button on any AI response to add it here."
                : "No items match your search."}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {filtered.map((it) => (
              <li key={it.id} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{it.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {it.item_type} · {new Date(it.created_at).toLocaleDateString()}
                  </div>
                  {it.content_text && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                      {it.content_text.slice(0, 240)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewing(it)}>
                    Open
                  </Button>
                  {it.content_text && (
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(it.content_text ?? "");
                        toast.success("Copied.");
                      }}
                      className="p-1.5 rounded hover:bg-accent transition active:scale-95"
                      title="Copy"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => remove(it.id)}
                    className="p-1.5 rounded hover:bg-accent transition active:scale-95"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <LibraryItemViewer item={viewing} onClose={() => setViewing(null)} onDelete={remove} />
      </div>


      <div>
        <h3 className="text-sm font-semibold mb-2">Shared with me</h3>
        {shared.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No chats shared with you yet.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shared.map((s) => (
              <li key={s.id} className="p-3">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Shared {new Date(s.created_at).toLocaleDateString()} · {s.snapshot.messages.length} messages
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Chats I've shared</h3>
        {mine.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            You haven't shared any chats yet. Use the Share button next to any chat in the sidebar.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {mine.map((s) => (
              <li key={s.id} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    To {s.recipient_email} · {s.status} · {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
                {s.status !== "revoked" && (
                  <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FinancesPanel() {
  const [status, setStatus] = useState<import("@/lib/finance.functions").FinanceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { getMyFinanceStatus } = await import("@/lib/finance.functions");
        setStatus(await getMyFinanceStatus());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Finances</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Connect accounts to view balances and organize financial context for KovaGPT.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : status?.plaidConfigured ? (
        <Button size="sm" onClick={() => toast.info("Plaid Link will open here once the client SDK is added.")}>
          Connect account
        </Button>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm space-y-2">
          <div className="font-medium">Bank linking is not configured yet</div>
          <p className="text-xs text-muted-foreground">
            To enable secure bank, brokerage, and credit-card linking, an admin must add Plaid
            credentials (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV) and an access-token encryption
            key on the server.
          </p>
          <Button size="sm" disabled className="opacity-60 cursor-not-allowed">
            Connect account
          </Button>
        </div>
      )}

      {status && status.accounts.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {status.accounts.map((a) => (
            <li key={a.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{a.account_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {[a.institution_name, a.account_type, a.account_subtype, a.mask && `••${a.mask}`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="text-sm font-medium tabular-nums">
                {a.current_balance != null
                  ? `${a.currency ?? "USD"} ${a.current_balance.toFixed(2)}`
                  : "—"}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        KovaGPT is not a financial advisor. Financial information may be incomplete or delayed.
        Always verify important decisions with your bank, brokerage, parent, or a qualified
        professional. Brokerage support (including Fidelity) depends on the connected account
        provider; availability may vary.
      </p>
    </section>
  );
}

// Limited settings panel shown to signed-out visitors. Includes only privacy
// preferences, appearance, and language. All copy is KovaGPT-branded (not
// copied from any other provider).
function SignedOutSettings({
  settings,
  onChange,
  setMode,
  onSignIn,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  setMode: (m: ThemeMode) => void;
  onSignIn: () => void;
}) {
  return (
    <div className="overflow-y-auto px-6 py-5 space-y-6 max-h-[78vh]">
      <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-start gap-3">
        <Lock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 text-sm">
          <div className="font-medium">You're browsing as a guest</div>
          <div className="text-xs text-muted-foreground mt-1">
            Sign in for your full settings, saved chats, Library, and Apps.
          </div>
          <Button size="sm" className="mt-3" onClick={onSignIn}>Sign in</Button>
        </div>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Privacy</h3>
        <ToggleRow
          title="Help Improve Kova"
          hint="Allow your content to help improve Kova's models and overall experience. We apply privacy protections to help keep your data safe."
          checked={settings.trainingOptOut !== true}
          onCheckedChange={(v) => onChange({ ...settings, trainingOptOut: !v })}
        />
        <ToggleRow
          title="Campaign Measurement"
          hint="Allow cookies that help Kova measure how well our marketing campaigns are performing."
          checked={false}
          onCheckedChange={() => {}}
        />
        <ToggleRow
          title="Personalized Marketing"
          hint="Allow Kova to personalize and measure our marketing on third-party platforms."
          checked={false}
          onCheckedChange={() => {}}
        />
        <ToggleRow
          title="Ad Personalization"
          hint="Use relevant activity, interests, and conversation context to make ads more useful to you."
          checked={false}
          onCheckedChange={() => {}}
        />
        <ToggleRow
          title="Past Chat Relevance"
          hint="Use past conversations and memory to improve ad relevance. Your chats and memories are not shared with advertisers."
          checked={false}
          onCheckedChange={() => {}}
        />
        {/* TODO(guest-privacy): persist guest privacy toggles in localStorage and
            wire them into analytics/consent logic. Currently UI-only. */}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Appearance</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize transition ${
                settings.mode === m
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:bg-muted"
              }`}
            >
              {m === "system" ? <Monitor className="w-4 h-4" /> : m === "light" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {m}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Language</h3>
        <Select value="auto" onValueChange={() => {}}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          KovaGPT replies in the language you write in.
        </p>
      </section>
    </div>
  );
}

