import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trash2,
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
  Database,
  HardDrive,
  Bug,
  LifeBuoy,
  Info,
  LogOut,
  RefreshCw,
  FolderOpen,
  Settings as Cog,
  Users,
  Keyboard,
  MapPin,
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
  connectorUnavailableLabel,
  connectorUnavailableReason,
  isConnectorActionable,
  type ConnectorItem,
} from "@/lib/connectors-catalog";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";
import { getMyDailyUsage, type DailyUsageDto } from "@/utils/usage.functions";
import {
  createPortalSession,
  getSubscriptionSummary,
  type SubscriptionSummary,
} from "@/utils/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { parseAllowedBillingPortalUrl } from "@/lib/billing-portal-url.mjs";
import { setSharedSendOnEnter, useSharedSendOnEnter } from "@/lib/composer-preferences";
import { PersonalitySliders } from "@/components/PersonalitySliders";
import { StorageDashboard } from "@/components/StorageDashboard";
import { FamilySharingPanel } from "@/components/FamilySharingPanel";
import { MfaPanel } from "@/components/MfaPanel";
import {
  loadArchivedConversations,
  loadConversations,
  saveArchivedConversations,
  saveConversations,
} from "@/lib/chat-store";
import {
  loadPrincipalStoredRecord,
  savePrincipalStoredRecord,
  WORKSPACE_DEFAULTS_KEY_BASE,
} from "@/lib/settings-storage";
import {
  browserStoragePrincipal,
  clearPrincipalBrowserStorage,
  dispatchPrincipalBrowserStorageCleared,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
import {
  allowMemoryWrites,
  blockMemoryWrites,
  configureMemoryWrites,
  deleteSavedMemoryAfterDraining,
} from "@/lib/memory-write-coordinator.mjs";
import {
  DEVICE_EXPORT_VERSION,
  mergeConversations,
  parseDeviceDataExport,
} from "@/lib/device-data-portability";
import { getUsage } from "@/lib/limits";
import { useUser, clerkEnabled } from "@/components/auth/ClerkSafe";
import { useClerkSafe as useClerk } from "@/components/auth/ClerkSafe";
import { applyThemeMode, DEFAULT_THEME, type ThemeColors, type ThemeMode } from "@/lib/theme";
import { authFetch } from "@/lib/auth-fetch";

export type Mood = "neutral" | "friendly" | "professional" | "concise";

export type Settings = {
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
  // Deprecated local-only value retained so old device exports still import safely.
  // It is not exposed as an account- or provider-level training control.
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

// Shared persisted-settings default; exported here until the settings schema is separated from the dialog.
// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_SETTINGS: Settings = {
  displayName: "",
  email: "",
  extraFacts: "",
  customInstructions: "",
  mood: "neutral",
  responseLength: "medium",
  rememberAcross: false,
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
type TabGroup = { title: string; hint?: string; tabs: TabDef[] };

// Settings are grouped into clear sections with headers so it doesn't read as
// one long stack of icons. Each group has a short caption describing what
// lives inside.
const TAB_GROUPS: TabGroup[] = [
  {
    title: "Account",
    hint: "Who you are and what powers your chats",
    tabs: [
      { v: "general", label: "General", icon: Cog },
      { v: "personalization", label: "Personalization", icon: User2 },
      { v: "memory", label: "Memory", icon: Brain },
      { v: "subscription", label: "Subscription", icon: CreditCard },
      { v: "email", label: "Email", icon: Mail },
    ],
  },
  {
    title: "Preferences",
    hint: "How KovaGPT looks and reaches you",
    tabs: [
      { v: "appearance", label: "Appearance", icon: Palette },
      { v: "notifications", label: "Notifications", icon: Bell },
      { v: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
      { v: "location", label: "Location", icon: MapPin },
      { v: "parental", label: "Parental controls", icon: Baby },
    ],
  },
  {
    title: "Data & security",
    hint: "Your account, storage, and privacy",
    tabs: [
      { v: "security", label: "Safety & security", icon: ShieldCheck },
      { v: "data", label: "Data control", icon: Database },
      { v: "storage", label: "Storage", icon: HardDrive },
    ],
  },
  {
    title: "Connections",
    hint: "Apps and people you share KovaGPT with",
    tabs: [
      { v: "linked", label: "Apps", icon: Link2 },
      { v: "family", label: "Family Center", icon: Users },
    ],
  },
  {
    title: "Support",
    tabs: [
      { v: "report", label: "Report an issue", icon: Bug },
      { v: "help", label: "Help center", icon: LifeBuoy },
      { v: "about", label: "About", icon: Info },
      { v: "logout", label: "Log out", icon: LogOut },
    ],
  },
];

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onClearAll,
  initialTab,
  onOpenHelp,
  returnFocusTarget,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClearAll: () => void;
  initialTab?: string;
  onOpenHelp?: () => void;
  returnFocusTarget?: HTMLElement | null;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(
    returnFocusTarget ??
      (typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
  );
  useEffect(() => {
    if (open && returnFocusTarget) returnFocusRef.current = returnFocusTarget;
  }, [open, returnFocusTarget]);
  const localUsage = open ? getUsage() : { images: 0, uploads: 0, date: "" };

  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const currentAuthUserKeyRef = useRef<string | null | undefined>(undefined);
  currentAuthUserKeyRef.current = isLoaded ? userKey : undefined;
  const sharedSendOnEnter = useSharedSendOnEnter(user?.id ?? null);
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
  const [subSummary, setSubSummary] = useState<SubscriptionSummary | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [clearMemoryConfirmOpen, setClearMemoryConfirmOpen] = useState(false);
  const [clearMemoryBusy, setClearMemoryBusy] = useState(false);

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
    if (!open || tab !== "subscription" || !loggedIn) return;
    let cancelled = false;
    setSubSummary(null);
    setSubscriptionError(null);
    setSubscriptionLoading(true);
    getSubscriptionSummary({ data: { environment: getStripeEnvironment() } })
      .then((summary) => {
        if (!cancelled) setSubSummary(summary);
      })
      .catch(() => {
        if (!cancelled) {
          setSubSummary(null);
          setSubscriptionError(
            "Billing details couldn't be verified. Select Refresh billing status to retry.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSubscriptionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, loggedIn]);

  const handleManageBilling = async () => {
    if (portalLoading || !subSummary?.hasBillingAccount) return;
    setPortalLoading(true);
    try {
      const res = await createPortalSession({ data: {} });
      if ("error" in res) throw new Error("billing_portal_unavailable");
      const portalUrl = parseAllowedBillingPortalUrl(res.url);
      if (!portalUrl) throw new Error("billing_portal_url_rejected");
      window.location.assign(portalUrl);
    } catch {
      toast.error("The billing portal couldn't be opened. Try again.");
    } finally {
      setPortalLoading(false);
    }
  };
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    setLinked(user?.id ? getLinkedAccounts(user.id) : []);
  }, [open, user?.id]);

  const setMode = (m: ThemeMode) => {
    applyThemeMode(m);
    onChange({ ...settings, mode: m });
  };

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const handleLogout = async () => {
    try {
      await clerk?.signOut();
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't sign out. Try again.");
    }
  };

  const clearLocalBrowserData = (
    targetUserKey: string | null | undefined = isLoaded ? userKey : undefined,
  ) => {
    const result = clearPrincipalBrowserStorage(targetUserKey);
    if (!result.resolved) return result;
    const failureCount = result.local.failures.length + result.session.failures.length;
    if (failureCount > 0) {
      console.warn("[local-data] Account-local browser cleanup was incomplete", {
        failureCount,
      });
    }
    return result;
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE" || deleteAccountBusy) return;
    const deletionUserKey = isLoaded ? userKey : undefined;
    setDeleteAccountBusy(true);
    let response: Response;
    try {
      response = await authFetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
    } catch (error) {
      console.error("[account-delete] request failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      toast.error("Account deletion could not be completed. Your account remains active.");
      setDeleteAccountBusy(false);
      return;
    }

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      toast.error(result?.error || "Account deletion failed. Your account remains active.");
      setDeleteAccountBusy(false);
      return;
    }

    // From this point on the server deletion is authoritative. Local UI,
    // storage, or sign-out failures may require browser cleanup, but must never
    // be reported as though the account remains active.
    let localCleanupIncomplete: boolean;
    try {
      const cleanupResult = clearLocalBrowserData(deletionUserKey);
      if (cleanupResult.resolved) {
        dispatchPrincipalBrowserStorageCleared(deletionUserKey);
      }
      if (currentAuthUserKeyRef.current === deletionUserKey) {
        onClearAll();
        setDeleteAccountOpen(false);
        onOpenChange(false);
      }
      const cleanupFailureCount =
        cleanupResult.local.failures.length + cleanupResult.session.failures.length;
      localCleanupIncomplete = !cleanupResult.resolved || cleanupFailureCount > 0;
    } catch (error) {
      localCleanupIncomplete = true;
      console.error("[account-delete] local cleanup failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
    }

    if (localCleanupIncomplete) {
      toast.warning(
        "Account deletion completed, but some data in this browser could not be removed. Clear KovaGPT site data in your browser settings.",
      );
    } else {
      toast.success("Account deletion completed. Active subscriptions were canceled.");
    }

    try {
      // The auth user no longer exists, so a post-delete sign-out failure must
      // not reclassify the already-completed server deletion as a failure.
      if (currentAuthUserKeyRef.current === deletionUserKey) await clerk?.signOut();
    } catch (error) {
      console.error("[account-delete] post-delete sign-out failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
    } finally {
      setDeleteAccountBusy(false);
    }
  };

  const handleClearSavedMemory = async () => {
    if (clearMemoryBusy) return;
    if (!isSignedIn || !userKey) {
      toast.error("Sign in to delete saved cross-chat memory.");
      return;
    }

    setClearMemoryBusy(true);
    // Block queued writes synchronously and persist the opt-out before waiting
    // for an already-started summary. The serialized delete then runs last, so
    // an in-flight POST cannot recreate memory after deletion succeeds.
    blockMemoryWrites(userKey);
    configureMemoryWrites({ principal: userKey, enabled: false });
    onChange({ ...settings, rememberAcross: false });

    try {
      const result = await deleteSavedMemoryAfterDraining({
        principal: userKey,
        run: async () => {
          const response = await authFetch("/api/memory", { method: "DELETE" });
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error || "Saved memory could not be deleted. Please try again.");
          }
        },
      });
      if (result !== "deleted") {
        throw new Error("Your account changed before saved memory could be deleted. Please retry.");
      }
      setClearMemoryConfirmOpen(false);
      toast.success("Saved cross-chat memory deleted. Memory remains off in this browser.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Saved memory could not be deleted. Please retry.";
      toast.error(`${message} Memory remains off in this browser.`);
    } finally {
      setClearMemoryBusy(false);
    }
  };

  const handleRestore = async () => {
    if (subscriptionLoading) return;
    setSubscriptionLoading(true);
    setSubscriptionError(null);
    try {
      const summary = await getSubscriptionSummary({
        data: { environment: getStripeEnvironment() },
      });
      setSubSummary(summary);
      if (summary.tier === "free") {
        toast.message("No active subscription found on this account.");
      } else {
        toast.success(`${summary.tier === "pro" ? "Pro" : "Plus"} plan refreshed.`);
      }
    } catch {
      setSubSummary(null);
      setSubscriptionError(
        "Billing details couldn't be verified. Select Refresh billing status to retry.",
      );
      toast.error("Couldn't check your subscription. Try again.");
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const inheritedSubscription = !!subSummary && tierRank(tier) > tierRank(subSummary.tier);
  const displayedSubscriptionTier = inheritedSubscription ? tier : subSummary?.tier;

  // "Saved" indicator: whenever settings change while the dialog is open, show
  // a subtle pill for ~1.5s. Skips the very first render so it doesn't fire on
  // open.
  const [savedPulse, setSavedPulse] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (!open) {
      firstRunRef.current = true;
      return;
    }
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    setSavedPulse(true);
    const t = setTimeout(() => setSavedPulse(false), 1500);
    return () => clearTimeout(t);
  }, [settings, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="kova-settings-dialog bg-[var(--surface-modal)] text-[var(--popover-foreground)] border border-border max-w-4xl max-h-[92vh] overflow-hidden flex flex-col gap-0 p-0 rounded-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (window.innerWidth < 1024) {
            document.querySelector<HTMLElement>('[aria-label="Open menu"]')?.focus();
            return;
          }
          const previous = returnFocusRef.current;
          if (previous?.isConnected && previous.getClientRects().length > 0) {
            previous.focus();
            return;
          }
          document.querySelector<HTMLElement>('[aria-label="Open menu"]')?.focus();
        }}
      >
        <DialogHeader className="px-5 sm:px-7 pt-5 pb-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-semibold tracking-tight font-display">
                Settings
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {loggedIn
                  ? "Changes save automatically."
                  : "Sign in to view and change your settings."}
              </p>
            </div>
            {loggedIn && (
              <div
                aria-live="polite"
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors duration-100 ${
                  savedPulse
                    ? "opacity-100 translate-y-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "opacity-0 -translate-y-1 border-transparent bg-transparent text-transparent pointer-events-none"
                }`}
              >
                <Check className="inline w-3 h-3 mr-1 -mt-0.5" />
                Saved
              </div>
            )}
          </div>
        </DialogHeader>

        {!loggedIn ? (
          <SignedOutSettings
            settings={settings}
            onChange={onChange}
            setMode={setMode}
            onSignIn={() => clerk?.openSignIn()}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <Tabs
            value={tab}
            onValueChange={setTab}
            orientation="vertical"
            className="flex-1 overflow-hidden flex flex-col md:flex-row"
          >
            {/* Mobile: one grouped picker keeps every section reachable without a 19-tab rail. */}
            <div className="kova-settings-mobile-nav flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 md:hidden">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                Settings section
              </span>
              <Select value={tab} onValueChange={setTab}>
                <SelectTrigger
                  aria-label="Settings section"
                  className="ml-auto h-11 min-w-0 max-w-56 rounded-xl bg-[var(--surface-modal)]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[min(70dvh,32rem)]">
                  {TAB_GROUPS.map((group) => (
                    <SelectGroup key={group.title}>
                      <SelectLabel className="text-xs text-muted-foreground">
                        {group.title}
                      </SelectLabel>
                      {group.tabs.map(({ v, icon: Icon, label }) => (
                        <SelectItem
                          key={v}
                          value={v}
                          className="kova-settings-mobile-section-option min-h-11 md:min-h-8"
                        >
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                            <span>{label}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Desktop: grouped sidebar */}
            <TabsList className="hidden md:flex flex-col h-full w-64 shrink-0 overflow-y-auto items-stretch justify-start gap-4 p-3 bg-muted/40 border-r border-border rounded-none">
              {TAB_GROUPS.map((group) => (
                <div key={group.title} className="flex flex-col gap-0.5">
                  <div className="px-2 pt-1 pb-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                      {group.title}
                    </div>
                    {group.hint && (
                      <div className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">
                        {group.hint}
                      </div>
                    )}
                  </div>
                  {group.tabs.map(({ v, icon: Icon, label }) => (
                    <TabsTrigger
                      key={v}
                      value={v}
                      className="w-full justify-start gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-colors"
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate text-left">{label}</span>
                    </TabsTrigger>
                  ))}
                </div>
              ))}
            </TabsList>

            <div className="flex-1 overflow-hidden flex flex-col">
              {/* GENERAL */}
              <TabsContent value="general" className="overflow-y-auto px-7 pb-8 space-y-6 py-5">
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
                    hint="On desktop, Enter sends when enabled. Shift+Enter always starts a new line; Ctrl/⌘+Enter sends either way. Mobile Enter starts a new line."
                    checked={sharedSendOnEnter}
                    onCheckedChange={(v) => {
                      setSharedSendOnEnter(user?.id ?? null, v);
                      onChange({ ...settings, sendOnEnter: v });
                    }}
                  />
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      Preferred response length
                    </label>
                    <Select
                      value={settings.responseLength}
                      onValueChange={(v) =>
                        onChange({
                          ...settings,
                          responseLength: v as Settings["responseLength"],
                        })
                      }
                    >
                      <SelectTrigger aria-label="Preferred response length">
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
                      <span>{localUsage.images}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Images uploaded</span>
                      <span>{localUsage.uploads}</span>
                    </div>
                  </div>
                </section>
                <WorkspaceDefaults userKey={userKey} principalResolved={isLoaded} />
              </TabsContent>

              {/* PERSONALIZATION */}
              <TabsContent
                value="personalization"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">About you</h3>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Preferred name
                    </label>
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
                      <SelectTrigger aria-label="Response tone">
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
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          customInstructions: e.target.value,
                        })
                      }
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y min-h-[90px]"
                    />
                  </div>
                </section>

                <section className="space-y-3">
                  <PersonalitySliders userKey={userKey} principalResolved={isLoaded} />
                </section>
              </TabsContent>

              {/* MEMORY */}
              <TabsContent value="memory" className="overflow-y-auto px-7 pb-8 space-y-6 py-5">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4" />
                    <h3 className="text-sm font-semibold">Memory</h3>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground">
                      Plus
                    </span>
                  </div>
                  {adaptiveMemoryUnlocked ? (
                    <>
                      <ToggleRow
                        title="Use saved memory"
                        hint="When enabled, eligible non-temporary chats sent from this browser can save bounded summaries and use relevant summaries in later chats. Other browsers keep their own setting."
                        checked={settings.rememberAcross}
                        onCheckedChange={(value) => {
                          if (value) allowMemoryWrites(userKey);
                          else blockMemoryWrites(userKey);
                          configureMemoryWrites({
                            principal: userKey,
                            enabled: value && isSignedIn,
                          });
                          onChange({ ...settings, rememberAcross: value });
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Turning this off stops saved-memory reads and new summary POSTs from chats
                        sent in this browser. It does not delete summaries already saved to your
                        account. Temporary Chat never sends profile, custom-instruction, or
                        personality settings and never reads or writes saved memory.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-lg border border-border p-4 flex items-start gap-3">
                      <Lock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 text-sm">
                        <div className="font-medium">Available on Kova Plus and Pro</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Paid plans can save bounded conversation summaries and use relevant ones
                          in later non-temporary chats.
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

                <section className="rounded-lg border border-border p-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium">Saved cross-chat memory</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Permanently delete every conversation summary stored for your account. Chats,
                      drafts, and preferences saved in this browser are not deleted. Memory is
                      turned off in this browser before deletion so a pending summary cannot
                      recreate the deleted data.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setClearMemoryConfirmOpen(true)}
                    disabled={clearMemoryBusy || !isSignedIn}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {clearMemoryBusy ? "Deleting…" : "Delete saved memory"}
                  </Button>
                </section>
              </TabsContent>

              <TabsContent value="linked" className="overflow-y-auto px-7 pb-8 space-y-5 py-5">
                {!loggedIn ? (
                  <SignInGate label="Apps" />
                ) : (
                  <>
                    <section className="space-y-1">
                      <h3 className="text-sm font-semibold">Apps</h3>
                      <p className="text-xs text-muted-foreground">
                        Connect external accounts so KovaGPT can use them in your chats. Live
                        integrations work today; others are on the roadmap.
                      </p>
                      <p className="text-xs text-muted-foreground pt-1">
                        Linking apps is free for everyone. Disconnect at any time.
                      </p>
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
                                canConnect={true}
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
              {/* Library and Finances tabs intentionally removed from Settings. */}

              {/* EMAIL */}
              <TabsContent value="email" className="overflow-y-auto px-7 pb-8 space-y-4 py-5">
                <h3 className="text-sm font-semibold">Email address</h3>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-sm font-medium">Primary email</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {user?.primaryEmailAddress?.emailAddress ?? "No email on file"}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Verification and security emails are sent here. Email-address changes are not
                  currently available in the app; contact support@kovagpt.com if you need help.
                </p>
              </TabsContent>

              {/* SUBSCRIPTION */}
              <TabsContent
                value="subscription"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Current plan</div>
                    {subscriptionLoading ? (
                      <div className="text-xs text-muted-foreground mt-1">
                        Checking billing status…
                      </div>
                    ) : subscriptionError ? (
                      <div className="text-xs text-destructive mt-1">
                        Billing details unavailable.
                      </div>
                    ) : displayedSubscriptionTier ? (
                      <div className="text-xs text-muted-foreground mt-1">
                        You're on the{" "}
                        {displayedSubscriptionTier === "free"
                          ? "Free"
                          : displayedSubscriptionTier === "plus"
                            ? "Plus"
                            : "Pro"}{" "}
                        plan
                        {inheritedSubscription ? " through Family Sharing" : ""}
                        {subSummary?.trialing ? " (free trial)" : ""}
                        {subSummary?.status === "past_due" ? " - payment past due" : ""}
                        {subSummary?.status === "unpaid" ? " - payment failed" : ""}
                        {subSummary?.status === "incomplete" ? " - awaiting first payment" : ""}.
                      </div>
                    ) : null}
                    {subSummary?.currentPeriodEnd && !inheritedSubscription && (
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {subSummary.trialing
                          ? `Trial ends ${new Date(subSummary.currentPeriodEnd).toLocaleDateString()} - billing starts then unless you cancel.`
                          : subSummary.cancelAtPeriodEnd
                            ? `Cancels on ${new Date(subSummary.currentPeriodEnd).toLocaleDateString()}. You keep access until then.`
                            : `Renews on ${new Date(subSummary.currentPeriodEnd).toLocaleDateString()}.`}
                      </div>
                    )}
                  </div>
                  {!subscriptionLoading &&
                    !subscriptionError &&
                    displayedSubscriptionTier === "free" &&
                    !subSummary?.hasBillingAccount && (
                      <Link
                        to="/pricing"
                        onClick={() => onOpenChange(false)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition whitespace-nowrap"
                      >
                        <Sparkles className="w-4 h-4" /> View plans
                      </Link>
                    )}
                </div>

                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Usage today</div>
                    {usage && (
                      <span className="text-[11px] text-muted-foreground">
                        Resets{" "}
                        {new Date(usage.resetsAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
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
                      Usage data isn't available right now. If you need help understanding your
                      limits, contact{" "}
                      <a
                        href="mailto:support@kovagpt.com"
                        className="underline hover:text-foreground"
                      >
                        support@kovagpt.com
                      </a>
                      .
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleManageBilling}
                      disabled={
                        portalLoading ||
                        subscriptionLoading ||
                        !!subscriptionError ||
                        !subSummary?.hasBillingAccount ||
                        inheritedSubscription
                      }
                      aria-describedby="billing-management-status"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      {portalLoading ? "Opening…" : "Manage subscription"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRestore}
                      disabled={subscriptionLoading || portalLoading}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      {subscriptionLoading ? "Checking…" : "Refresh billing status"}
                    </Button>
                  </div>
                  <p
                    id="billing-management-status"
                    role={subscriptionError ? "alert" : undefined}
                    className={`text-xs ${subscriptionError ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {subscriptionError
                      ? subscriptionError
                      : subscriptionLoading
                        ? "Checking the billing account linked to this KovaGPT account."
                        : inheritedSubscription
                          ? "This shared plan is managed by the Family Sharing owner."
                          : subSummary?.hasBillingAccount
                            ? "Manage payment methods, invoices, cancellation, and plan changes in the Stripe billing portal."
                            : "No Stripe billing account is linked to this KovaGPT account."}
                  </p>
                </div>

                {subSummary?.hasBillingAccount &&
                  !inheritedSubscription &&
                  displayedSubscriptionTier !== "free" && (
                    <div className="rounded-lg border border-border p-4 space-y-2">
                      <div className="text-sm font-medium">Cancel subscription</div>
                      <p className="text-xs text-muted-foreground">
                        You can cancel from the Stripe billing portal above. After canceling, you'll
                        keep access to your current plan until the end of the billing period.
                      </p>
                    </div>
                  )}

                <div className="rounded-lg border border-border p-4 space-y-2">
                  <div className="text-sm font-medium">Account and data deletion</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Use Data controls to request self-service account deletion. KovaGPT verifies
                    billing first, cancels active subscriptions, disconnects stored credentials, and
                    then deletes the sign-in account and associated database records. For help or a
                    specific privacy request, contact{" "}
                    <a
                      href="mailto:support@kovagpt.com"
                      className="underline hover:text-foreground"
                    >
                      support@kovagpt.com
                    </a>{" "}
                    from the email connected to your account. Some billing, security, and backup
                    records may be retained when required by law or operational policy.
                  </p>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground pt-1">
                  <Link
                    to="/getting-started"
                    onClick={() => onOpenChange(false)}
                    className="underline hover:text-foreground"
                  >
                    Getting started
                  </Link>
                  <Link
                    to="/contact-support"
                    onClick={() => onOpenChange(false)}
                    className="underline hover:text-foreground"
                  >
                    Contact support
                  </Link>
                  <Link
                    to="/privacy"
                    onClick={() => onOpenChange(false)}
                    className="underline hover:text-foreground"
                  >
                    Privacy policy
                  </Link>
                  <Link
                    to="/terms"
                    onClick={() => onOpenChange(false)}
                    className="underline hover:text-foreground"
                  >
                    Terms of service
                  </Link>
                  <Link
                    to="/refund"
                    onClick={() => onOpenChange(false)}
                    className="underline hover:text-foreground"
                  >
                    Refund policy
                  </Link>
                </div>

                <p className="text-xs text-muted-foreground">
                  Payments are securely handled by Stripe. We never see or store your card number.
                </p>
              </TabsContent>

              {/* APPEARANCE */}
              <TabsContent value="appearance" className="overflow-y-auto px-7 pb-8 space-y-6 py-5">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Appearance</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose how KovaGPT looks. System follows your device.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { v: "light", label: "Light", Icon: Sun },
                        { v: "dark", label: "Dark", Icon: Moon },
                        { v: "system", label: "System", Icon: Monitor },
                      ] as const
                    ).map(({ v, label, Icon }) => {
                      const active = (settings.mode ?? "system") === v;
                      return (
                        <button
                          key={v}
                          onClick={() => setMode(v)}
                          className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-4 py-5 text-sm font-medium transition ${
                            active
                              ? "border-foreground bg-accent text-foreground"
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
              <TabsContent
                value="notifications"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <h3 className="text-sm font-semibold">Notifications</h3>
                <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Account &amp; security emails</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sign-in alerts, verification, and important account changes cannot be turned
                      off for security.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                    Always on
                  </span>
                </div>
                <div className="rounded-lg border border-dashed border-border p-4" role="note">
                  <p className="text-sm font-medium">Optional email preferences are unavailable</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Product-update and tips controls are not connected to the delivery service yet,
                    so KovaGPT does not show switches that would have no effect. Use the unsubscribe
                    link in an optional email or contact support for help.
                  </p>
                  <Link
                    to="/contact-support"
                    onClick={() => onOpenChange(false)}
                    className="mt-3 inline-flex min-h-11 items-center text-sm font-medium underline"
                  >
                    Contact support
                  </Link>
                </div>
              </TabsContent>

              {/* PARENTAL */}
              <TabsContent value="parental" className="overflow-y-auto px-7 pb-8 space-y-5 py-5">
                <h3 className="text-sm font-semibold">Parental controls</h3>
                <FamilyControlsUnavailable />
                <p className="text-xs text-muted-foreground">
                  For full device-level parental controls (screen time, app restrictions), use your
                  device's built-in settings.
                </p>
              </TabsContent>

              {/* KEYBOARD SHORTCUTS */}
              <TabsContent value="shortcuts" className="overflow-y-auto px-7 pb-8 space-y-4 py-5">
                <div>
                  <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Customize shortcuts for common actions. Click a combo to record a new one.
                  </p>
                </div>
                <ShortcutsEditor userKey={userKey} principalResolved={isLoaded} />
              </TabsContent>

              {/* LOCATION */}
              <TabsContent value="location" className="overflow-y-auto px-7 pb-8 space-y-5 py-5">
                <div>
                  <h3 className="text-sm font-semibold">Location</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Location-based personalization is not connected to chat or Maps yet.
                  </p>
                </div>
                <LocationControlsUnavailable />
              </TabsContent>

              {/* SAFETY & SECURITY */}
              <TabsContent value="security" className="overflow-y-auto px-7 pb-8 space-y-6 py-5">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-sm font-medium">Signed in as</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {user?.primaryEmailAddress?.emailAddress ?? user?.firstName ?? "your account"}
                  </div>
                </div>
                {loggedIn ? (
                  <MfaPanel />
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Sign in to manage two-factor authentication and active sessions.
                  </div>
                )}
              </TabsContent>

              {/* DATA CONTROL */}
              <TabsContent value="data" className="overflow-y-auto px-7 pb-8 space-y-4 py-5">
                <h3 className="text-sm font-semibold">Data controls</h3>
                <ArchivedChatsPanel userKey={userKey} />
                <div
                  role="note"
                  className="rounded-lg border border-border bg-muted/30 p-4 space-y-2"
                >
                  <div className="text-sm font-medium">AI data controls</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Model-training preferences are not available in Settings. Review the{" "}
                    <Link
                      to="/privacy"
                      onClick={() => onOpenChange(false)}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Privacy Policy
                    </Link>{" "}
                    to understand how chats may be processed by KovaGPT and its AI providers.
                  </p>
                </div>
                <SecurityRow
                  title="Export your data"
                  body="Download chats, archived chats, and preferences stored on this device. Cloud account records are not included."
                  actionLabel="Download"
                  onAction={() => {
                    try {
                      const payload = {
                        format: "kovagpt-device-export",
                        version: DEVICE_EXPORT_VERSION,
                        exportedAt: new Date().toISOString(),
                        scope: "this-device",
                        settings,
                        conversations: loadConversations(userKey),
                        archivedConversations: loadArchivedConversations(userKey),
                      };
                      const blob = new Blob([JSON.stringify(payload, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `kovagpt-export-${new Date().toISOString().slice(0, 10)}.json`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                      toast.success("Export downloaded.");
                    } catch {
                      toast.error("Could not build export. Try again.");
                    }
                  }}
                />
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  aria-label="Choose KovaGPT export"
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    try {
                      const imported = parseDeviceDataExport(await file.text());
                      const conversations = mergeConversations(
                        loadConversations(userKey),
                        imported.conversations,
                      );
                      const archived = mergeConversations(
                        loadArchivedConversations(userKey),
                        imported.archivedConversations,
                      );
                      saveConversations(userKey, conversations);
                      saveArchivedConversations(userKey, archived);
                      window.dispatchEvent(new Event("kova:conversations-imported"));
                      toast.success(
                        `Imported ${imported.conversations.length + imported.archivedConversations.length} chats.`,
                      );
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Could not import data.",
                      );
                    }
                  }}
                />
                <SecurityRow
                  title="Import chat history"
                  body="Merge active and archived chats from a KovaGPT device-data export. Existing newer chats are kept."
                  actionLabel="Choose file"
                  onAction={() => importFileRef.current?.click()}
                />
                <SecurityRow
                  title="Delete account"
                  body="Cancel active subscriptions, disconnect stored credentials, and delete your sign-in account and associated cloud records. Legally required billing, security, and backup records may be retained."
                  actionLabel="Delete account"
                  danger
                  onAction={() => {
                    setDeleteConfirmation("");
                    setDeleteAccountOpen(true);
                  }}
                />
              </TabsContent>

              {/* STORAGE */}
              <TabsContent value="storage" className="overflow-y-auto px-7 pb-8 space-y-4 py-5">
                <StorageDashboard signedIn={loggedIn} />
                <div className="rounded-xl border border-border bg-card/60 p-5 space-y-3">
                  <h3 className="text-sm font-semibold">Local device data</h3>
                  <p className="text-xs text-muted-foreground">
                    Resets chats, drafts, handoffs, work data, and account preferences stored for
                    this KovaGPT profile on this browser. Ownerless private data, including
                    transitional values from older versions, is also removed so another profile
                    cannot receive it. Other profiles' scoped data, device-wide display preferences,
                    and cloud data are preserved.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      const result = clearLocalBrowserData();
                      if (!result.resolved) {
                        toast.error("Account data is still loading. Try again in a moment.");
                        return;
                      }
                      dispatchPrincipalBrowserStorageCleared(userKey);
                      onChange(DEFAULT_SETTINGS);
                      onClearAll();
                      const failureCount =
                        result.local.failures.length + result.session.failures.length;
                      if (failureCount > 0) {
                        toast.warning("Some local data could not be reset. Reload and try again.");
                      } else {
                        toast.success("This profile's local browser data was reset.");
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Reset this profile's local data
                  </Button>
                </div>
              </TabsContent>

              {/* FAMILY CENTER */}
              <TabsContent value="family" className="overflow-y-auto px-7 pb-8 space-y-5 py-5">
                {!loggedIn ? <SignInGate label="Family Sharing" /> : <FamilySharingPanel />}
              </TabsContent>

              {/* REPORT ISSUE */}
              <TabsContent value="report" className="overflow-y-auto px-7 pb-8 space-y-4 py-5">
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
              <TabsContent value="help" className="overflow-y-auto px-7 pb-8 space-y-4 py-5">
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
              <TabsContent value="about" className="overflow-y-auto px-7 pb-8 space-y-3 py-5">
                <h3 className="text-sm font-semibold">About KovaGPT</h3>
                <p className="text-sm text-muted-foreground">
                  KovaGPT is built by Zachary Block. Our mission is to make a helpful, kind, and
                  trustworthy AI available to everyone.
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
              <TabsContent value="logout" className="overflow-y-auto px-7 pb-8 space-y-4 py-5">
                <h3 className="text-sm font-semibold">Log out</h3>
                <p className="text-sm text-muted-foreground">
                  You'll be signed out of KovaGPT on this device.
                </p>
                <Button variant="destructive" size="sm" onClick={() => setLogoutConfirmOpen(true)}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Log out
                </Button>
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        onConfirm={handleLogout}
      />
      <AlertDialog
        open={clearMemoryConfirmOpen}
        onOpenChange={(next) => {
          if (!clearMemoryBusy) setClearMemoryConfirmOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved cross-chat memory?</AlertDialogTitle>
            <AlertDialogDescription>
              Memory will first be turned off in this browser and any summary already in progress
              will finish before deletion runs. This permanently deletes every conversation summary
              stored for your account. Browser-saved chats are not deleted. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearMemoryBusy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleClearSavedMemory}
              disabled={clearMemoryBusy}
            >
              {clearMemoryBusy ? "Deleting…" : "Delete saved memory"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteAccountOpen}
        onOpenChange={(next) => {
          if (deleteAccountBusy) return;
          setDeleteAccountOpen(next);
          if (!next) setDeleteConfirmation("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This cancels active subscriptions, disconnects stored credentials, and deletes your
              sign-in account and associated cloud records. Legally required billing, security, and
              backup records may be retained. This action cannot be undone. Type DELETE to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder="Type DELETE"
            aria-label="Type DELETE to confirm"
            autoComplete="off"
            disabled={deleteAccountBusy}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccountBusy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteConfirmation !== "DELETE" || deleteAccountBusy}
            >
              {deleteAccountBusy ? "Deleting…" : "Delete account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const actionable = isConnectorActionable(item);
  // Some genuinely connectable entries (e.g. Google Calendar) are covered by a
  // broader account grant and have no standalone row of their own, so they are
  // managed from the Apps page rather than toggled here.
  const provider = item.legacyProvider ?? null;
  const connected = actionable && !!provider && linked.includes(provider);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-muted text-foreground flex items-center justify-center text-xs font-semibold shrink-0">
          {item.label.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">{item.label}</div>
          <div className="text-xs text-muted-foreground truncate">{item.description}</div>
        </div>
      </div>
      {!actionable ? (
        <span
          className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
          title={connectorUnavailableReason(item)}
        >
          {connectorUnavailableLabel(item)}
        </span>
      ) : !provider ? (
        <Button asChild variant="outline" size="sm" className="h-8 shrink-0">
          <Link to="/apps">Manage in Apps</Link>
        </Button>
      ) : connected ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-xs text-foreground">
            <Check className="w-3.5 h-3.5" /> Connected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDisconnect(provider)}
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
          onClick={() => onConnect(provider)}
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
          <path
            fill="#EA4335"
            d="M12 13.065L1.5 5.4V18a1.5 1.5 0 0 0 1.5 1.5h3V11l6 4.5 6-4.5v8.5h3a1.5 1.5 0 0 0 1.5-1.5V5.4L12 13.065z"
          />
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
          <path
            fill="#F4B400"
            d="M2 13.57L7.71 21h8.58L10.57 11l-4.28-7.43L2 13.57z"
            opacity=".85"
          />
          <path
            fill="#4285F4"
            d="M22 13.57L16.29 21H7.71L13.43 11l4.28-7.43L22 13.57z"
            opacity=".7"
          />
        </svg>
      </div>
    );
  }
  return (
    <div className={base + " bg-white border border-border"}>
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
        />
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
  danger,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors ${
        danger ? "border-destructive/40 bg-destructive/5" : "border-border"
      }`}
    >
      <div className="min-w-0">
        <div className={`text-sm font-medium ${danger ? "text-destructive" : ""}`}>{title}</div>
        <div className="text-xs text-muted-foreground mt-1">{body}</div>
      </div>
      <Button
        size="sm"
        variant={danger ? "destructive" : "outline"}
        onClick={onAction}
        className={danger ? "shadow-sm" : ""}
      >
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
  const controlId = useId();
  const hintId = hint ? `${controlId}-hint` : undefined;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={controlId} className="text-sm font-medium">
          {title}
        </label>
        {hint && (
          <div id={hintId} className="text-xs text-muted-foreground mt-0.5">
            {hint}
          </div>
        )}
      </div>
      <Switch
        id={controlId}
        aria-describedby={hintId}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

type LibItem = import("@/lib/library.functions").LibraryItem;

type WorkspaceDefaultValues = {
  prompt: string;
  research: string;
  artifact: string;
};

const DEFAULT_WORKSPACE_DEFAULTS: WorkspaceDefaultValues = {
  prompt: "General",
  research: "Balanced sources",
  artifact: "Edit",
};

function WorkspaceDefaults({
  userKey,
  principalResolved,
}: {
  userKey: string | null;
  principalResolved: boolean;
}) {
  const [defaults, setDefaults] = useState<WorkspaceDefaultValues>(DEFAULT_WORKSPACE_DEFAULTS);

  useEffect(() => {
    if (!principalResolved) {
      setDefaults(DEFAULT_WORKSPACE_DEFAULTS);
      return;
    }
    const stored = loadPrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, userKey, {
      migrateLegacyGuest: userKey === null,
    });
    setDefaults(
      stored
        ? ({ ...DEFAULT_WORKSPACE_DEFAULTS, ...stored } as WorkspaceDefaultValues)
        : DEFAULT_WORKSPACE_DEFAULTS,
    );
  }, [principalResolved, userKey]);

  const update = (key: string, value: string) => {
    const next = { ...defaults, [key]: value };
    setDefaults(next);
    if (!principalResolved) return;
    try {
      savePrincipalStoredRecord(WORKSPACE_DEFAULTS_KEY_BASE, userKey, next);
    } catch {
      /* ignore */
    }
  };
  const fields = [
    ["prompt", "Prompt defaults", ["General", "Writing", "Research", "Analysis", "Coding"]],
    [
      "research",
      "Research defaults",
      ["Balanced sources", "Primary sources", "Academic sources", "Recent sources"],
    ],
    ["artifact", "Artifact defaults", ["Edit", "Preview", "Split view"]],
  ] as const;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Workspace preferences</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          These preferences apply the next time you open the matching workspace on this device.
        </p>
      </div>
      {fields.map(([key, label, options]) => (
        <label key={key} className="block text-xs text-muted-foreground">
          {label}
          <select
            value={defaults[key]}
            onChange={(event) => update(key, event.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground"
          >
            {options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      ))}
    </section>
  );
}

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
  const [imgRetry, setImgRetry] = useState(0);
  const itemId = item?.id;
  const itemType = item?.item_type;
  useEffect(() => setImgRetry(0), [itemId]);
  useEffect(() => {
    let cancelled = false;
    setImgUrl(null);
    setImgErr(null);
    if (!itemId || itemType !== "image") return;
    (async () => {
      try {
        const { getLibraryImageUrl } = await import("@/lib/library-images.functions");
        const { url } = await getLibraryImageUrl({ data: { id: itemId } });
        if (!cancelled) setImgUrl(url);
      } catch (e) {
        if (!cancelled) setImgErr(e instanceof Error ? e.message : "Could not load image");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imgRetry, itemId, itemType]);

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
              <img
                src={imgUrl}
                alt={item?.title ?? ""}
                className="max-h-[55vh] mx-auto rounded-lg"
                onError={() => {
                  if (imgRetry < 2) setImgRetry((attempt) => attempt + 1);
                  else setImgErr("Image preview unavailable. Close and reopen this item to retry.");
                }}
              />
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
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LibraryPanel() {
  const [items, setItems] = useState<LibItem[]>([]);
  const [shared, setShared] = useState<import("@/lib/shared-chats.functions").SharedChatInbox[]>(
    [],
  );
  const [mine, setMine] = useState<import("@/lib/shared-chats.functions").SharedChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewing, setViewing] = useState<LibItem | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
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
      console.error("[settings] library load failed");
      setLoadError(e instanceof Error ? e.message : "Library data could not be loaded.");
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
      if (
        typeFilter === "other" &&
        ["chat_artifact", "document", "code", "image"].includes(it.item_type)
      )
        return false;
    }
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return it.title.toLowerCase().includes(q) || (it.content_text ?? "").toLowerCase().includes(q);
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
            <SelectTrigger aria-label="Filter library by item type" className="h-8 text-xs sm:w-44">
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

        {loadError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
          >
            <p className="text-sm font-medium text-destructive">Library data is unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
            <Button size="sm" variant="outline" onClick={load} className="mt-3">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
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
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setViewing(it)}
                  >
                    Open
                  </Button>
                  {it.content_text && (
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(it.content_text ?? "");
                        toast.success("Copied.");
                      }}
                      className="p-1.5 rounded hover:bg-accent transition"
                      title="Copy"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => remove(it.id)}
                    className="p-1.5 rounded hover:bg-accent transition"
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
                  Shared {new Date(s.created_at).toLocaleDateString()} ·{" "}
                  {s.snapshot.messages.length} messages
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
                    To {s.recipient_email} · {s.status} ·{" "}
                    {new Date(s.created_at).toLocaleDateString()}
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

// FinancesPanel removed - the Finances tab is no longer part of Settings.

// Limited settings panel shown to signed-out visitors. Includes only privacy
// preferences, appearance, and language. All copy is KovaGPT-branded (not
// copied from any other provider).
function SignedOutSettings({
  settings,
  onChange,
  setMode,
  onSignIn,
  onClose,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  setMode: (m: ThemeMode) => void;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<"general" | "data">("general");
  void onChange;

  return (
    <div className="kova-settings-surface flex max-h-[78vh] min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-modal)] md:flex-row">
      <nav
        aria-label="Settings sections"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3"
      >
        {(
          [
            ["general", "General", Cog],
            ["data", "Data controls", Database],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSection(value)}
            aria-current={section === value}
            className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              section === value
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {section === "general" ? (
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between gap-4 py-4 first:pt-0">
              <span className="text-sm">Appearance</span>
              <div className="w-44">
                <Select
                  value={settings.mode ?? "system"}
                  onValueChange={(v) => setMode(v as ThemeMode)}
                >
                  <SelectTrigger aria-label="Appearance">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <span className="text-sm">Language</span>
              <div className="w-44">
                <GuestLanguageSelect />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <div className="text-sm">Account</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sign in to sync chats, memory, and settings across devices.
                </p>
              </div>
              <Button onClick={onSignIn} className="h-9 rounded-full px-5 text-sm">
                Sign in
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <ArchivedChatsPanel userKey={null} />
            <div className="rounded-xl border border-border/60 bg-card/40 p-4">
              <div className="text-sm font-medium">How signed-out data is stored</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Signed-out chats stay in this tab until you refresh or close it. Appearance and
                language preferences remain in this browser, but nothing here is synced to an
                account. Read the{" "}
                <Link
                  to="/privacy"
                  onClick={onClose}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Privacy Policy
                </Link>{" "}
                for the data-processing terms that apply.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ArchivedChatsPanel({ userKey }: { userKey: string | null }) {
  const [revision, setRevision] = useState(0);
  const archived = loadArchivedConversations(userKey);

  return (
    <section
      className="rounded-xl border border-border/70 bg-card/60 p-4"
      aria-label="Archived chats"
    >
      <div className="mb-3">
        <h4 className="text-sm font-medium">Archived chats</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Review or restore conversations you moved out of your sidebar.
        </p>
      </div>
      <div className="space-y-1" key={revision}>
        {archived.length ? (
          archived.map((chat) => (
            <div
              key={chat.id}
              className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent/60"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{chat.title}</span>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  saveConversations(
                    userKey,
                    mergeConversations(loadConversations(userKey), [chat]),
                  );
                  saveArchivedConversations(
                    userKey,
                    loadArchivedConversations(userKey).filter((item) => item.id !== chat.id),
                  );
                  setRevision((value) => value + 1);
                  window.dispatchEvent(new Event("kova:conversations-imported"));
                  toast.success("Chat restored");
                }}
              >
                Restore
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                aria-label={`Delete archived chat ${chat.title}`}
                onClick={() => {
                  if (!window.confirm(`Permanently delete "${chat.title}"?`)) return;
                  saveArchivedConversations(
                    userKey,
                    loadArchivedConversations(userKey).filter((item) => item.id !== chat.id),
                  );
                  setRevision((value) => value + 1);
                  toast.success("Archived chat deleted");
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">No archived chats</p>
        )}
      </div>
    </section>
  );
}

const KOVA_LANGUAGES: { value: string; label: string }[] = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es", label: "Español" },
  { value: "es-MX", label: "Español (México)" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "nl", label: "Nederlands" },
  { value: "sv", label: "Svenska" },
  { value: "no", label: "Norsk" },
  { value: "da", label: "Dansk" },
  { value: "fi", label: "Suomi" },
  { value: "pl", label: "Polski" },
  { value: "cs", label: "Čeština" },
  { value: "ro", label: "Română" },
  { value: "hu", label: "Magyar" },
  { value: "el", label: "Ελληνικά" },
  { value: "tr", label: "Türkçe" },
  { value: "ru", label: "Русский" },
  { value: "uk", label: "Українська" },
  { value: "ar", label: "العربية" },
  { value: "he", label: "עברית" },
  { value: "fa", label: "فارسی" },
  { value: "hi", label: "हिन्दी" },
  { value: "bn", label: "বাংলা" },
  { value: "ur", label: "اردو" },
  { value: "ta", label: "தமிழ்" },
  { value: "te", label: "తెలుగు" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "ms", label: "Bahasa Melayu" },
  { value: "tl", label: "Tagalog" },
  { value: "zh-CN", label: "中文 (简体)" },
  { value: "zh-TW", label: "中文 (繁體)" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "sw", label: "Kiswahili" },
  { value: "af", label: "Afrikaans" },
];

function GuestLanguageSelect() {
  const KEY = "kova-guest-language";
  const [value, setValue] = useState<string>("auto");
  useEffect(() => {
    try {
      setValue(localStorage.getItem(KEY) || "auto");
    } catch {
      /* noop */
    }
  }, []);
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        setValue(v);
        try {
          localStorage.setItem(KEY, v);
        } catch {
          /* noop */
        }
      }}
    >
      <SelectTrigger aria-label="Language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {KOVA_LANGUAGES.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------- Family safety availability ----------

function FamilyControlsUnavailable() {
  return (
    <div className="rounded-lg border border-dashed border-border p-4" role="note">
      <p className="text-sm font-medium">Family controls are not available yet</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        KovaGPT does not currently enforce an account-level family content policy or a PIN lock. Use
        your device and network parental controls in the meantime.
      </p>
    </div>
  );
}

// ---------- Keyboard shortcuts editor ----------

function ShortcutsEditor({
  userKey,
  principalResolved,
}: {
  userKey: string | null;
  principalResolved: boolean;
}) {
  // Lazy-load lib to keep imports colocated at usage.
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const [list, setList] = useState<import("@/lib/shortcuts").Shortcut[]>([]);
  const [listPrincipal, setListPrincipal] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const ready = principal !== null && listPrincipal === principal;
  const visibleList = useMemo(() => (ready ? list : []), [list, ready]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("@/lib/shortcuts");
      if (!cancelled) {
        setList(principal ? mod.loadShortcuts(userKey) : []);
        setListPrincipal(principal);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [principal, userKey]);

  useEffect(() => {
    if (!principalResolved || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      setList([]);
      setListPrincipal(null);
      setRecordingId(null);
      void import("@/lib/shortcuts").then((mod) => {
        if (principalRef.current !== principal) return;
        setList(mod.DEFAULT_SHORTCUTS);
        setListPrincipal(principal);
      });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [principal, principalResolved, userKey]);

  useEffect(() => {
    if (!recordingId) return;
    const onKey = async (e: KeyboardEvent) => {
      if (!ready) return;
      e.preventDefault();
      e.stopPropagation();
      // Ignore lone modifiers.
      if (["Shift", "Control", "Meta", "Alt"].includes(e.key)) return;
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("Mod");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key);
      const combo = parts.join("+");
      const actionPrincipal = principal;
      const mod = await import("@/lib/shortcuts");
      if (!actionPrincipal || principalRef.current !== actionPrincipal) return;
      const next = visibleList.map((s) => (s.id === recordingId ? { ...s, combo } : s));
      setList(next);
      mod.saveShortcuts(userKey, next);
      setRecordingId(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, {
        capture: true,
      } as unknown as EventListenerOptions);
  }, [principal, recordingId, ready, userKey, visibleList]);

  const reset = async () => {
    const mod = await import("@/lib/shortcuts");
    if (!ready) return;
    mod.resetShortcuts(userKey);
    setList(mod.DEFAULT_SHORTCUTS);
    toast.success("Shortcuts reset");
  };

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border divide-y divide-border">
        {visibleList.map((s) => (
          <ShortcutRow
            key={s.id}
            id={s.id}
            label={s.label}
            description={s.description}
            combo={s.combo}
            recording={recordingId === s.id}
            onRecord={() => setRecordingId(s.id)}
            onCancel={() => setRecordingId(null)}
          />
        ))}
      </div>
      <div>
        <Button size="sm" variant="outline" onClick={reset}>
          Reset to defaults
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Shortcuts are saved to this browser. "Mod" is ⌘ on macOS, Ctrl elsewhere.
      </p>
    </div>
  );
}

function ShortcutRow({
  label,
  description,
  combo,
  recording,
  onRecord,
  onCancel,
}: {
  id: string;
  label: string;
  description: string;
  combo: string;
  recording: boolean;
  onRecord: () => void;
  onCancel: () => void;
}) {
  const [display, setDisplay] = useState(combo);
  useEffect(() => {
    let alive = true;
    (async () => {
      const mod = await import("@/lib/shortcuts");
      if (alive) setDisplay(mod.displayCombo(combo));
    })();
    return () => {
      alive = false;
    };
  }, [combo]);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <button
        onClick={recording ? onCancel : onRecord}
        className={`text-xs px-3 py-1.5 rounded-md border font-mono min-w-[6rem] text-center transition ${
          recording
            ? "border-primary bg-primary/10 text-primary animate-pulse"
            : "border-border hover:bg-accent"
        }`}
      >
        {recording ? "Press keys…" : display}
      </button>
    </div>
  );
}

// ---------- Location availability ----------

function LocationControlsUnavailable() {
  return (
    <div className="rounded-lg border border-dashed border-border p-4" role="note">
      <div className="flex gap-3">
        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Device location is not requested</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            KovaGPT will not request, save, or send your device coordinates from Settings. You can
            still type a city or place into chat when location context is useful.
          </p>
        </div>
      </div>
    </div>
  );
}
