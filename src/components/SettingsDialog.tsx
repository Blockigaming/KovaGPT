import "@/styles/billing-surfaces.css";
import { BillingWorkspace, BillingSubscriptionFacts } from "@/components/BillingWorkspace";
import "@/styles/settings-reference.css";
import "@/styles/settings-page-layout.css";
import { WorkspacePageUtilities } from "@/components/WorkspacePageUtilities";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { ProfileSettings } from "@/components/ProfileSettings";
import { formatDisplayDateTime } from "@/lib/time-format";
import { useTimeFormatPreference } from "@/hooks/use-time-format-preference";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { parseAccountDeletionStatus, requestAccountDeletion } from "@/lib/account-deletion-client";
import { AccountEmailPreferences } from "@/components/AccountEmailPreferences";
import { AccountExportPanel } from "@/components/AccountExportPanel";
import { ChatTrashPanel } from "@/components/ChatTrashPanel";
import { readChatTrash, writeChatTrash } from "@/lib/chat-trash";
import { TRASH_RETENTION_OPTIONS } from "@/lib/chat-trash-policy.mjs";
import { PwaSettings } from "@/components/PwaSettings";
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
import { SearchablePicker } from "@/components/ui/searchable-picker";
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
  Search,
  ArrowLeft,
  BarChart3,
} from "lucide-react";
import { useTier, tierRank } from "@/hooks/useTier";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ComponentProps,
} from "react";
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
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
import { resetPrincipalDeviceData } from "@/lib/principal-device-reset.mjs";
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
import { getUsage, DAILY_IMAGE_LIMIT, DAILY_UPLOAD_LIMIT } from "@/lib/limits";
import { useUser, clerkEnabled } from "@/components/auth/ClerkSafe";
import { useClerkSafe as useClerk } from "@/components/auth/ClerkSafe";
import { applyThemeMode, type ThemeMode } from "@/lib/theme";
import { authFetch } from "@/lib/auth-fetch";

import {
  DEFAULT_SETTINGS,
  settingsSectionForTab,
  type Mood,
  type Settings,
} from "@/lib/settings-types";
// Preserve the existing component-module API for code that imports this view.
export { DEFAULT_SETTINGS, SETTINGS_SECTIONS, settingsSectionForTab } from "@/lib/settings-types";
export type { Mood, Settings } from "@/lib/settings-types";

const MOODS: { value: Mood; label: string; hint: string }[] = [
  { value: "neutral", label: "Neutral", hint: "Balanced and helpful" },
  { value: "friendly", label: "Friendly", hint: "Warm and approachable" },
  { value: "professional", label: "Professional", hint: "Polished and formal" },
  { value: "concise", label: "Concise", hint: "Short, direct answers" },
];

type TabDef = { v: string; label: string; icon: typeof Cog; keywords?: string[] };
type TabGroup = { title: string; hint?: string; tabs: TabDef[] };

// Settings are grouped into clear sections with headers so it doesn't read as
// one long stack of icons. Each group has a short caption describing what
// lives inside.
const TAB_GROUPS: TabGroup[] = [
  {
    title: "Account",
    hint: "Who you are and what powers your chats",
    tabs: [
      { v: "general", label: "Responses", icon: Sparkles },
      { v: "personalization", label: "Profile", icon: User2 },
      { v: "memory", label: "Memory", icon: Brain },
      {
        v: "billing",
        label: "Subscriptions",
        icon: CreditCard,
        keywords: ["plan", "subscription", "payment", "invoice"],
      },
      {
        v: "usage",
        label: "Usage",
        icon: BarChart3,
        keywords: ["limits", "messages", "images", "uploads"],
      },
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

function SettingsPageContent({ children, className }: ComponentProps<typeof DialogContent>) {
  return (
    <section className={`kova-settings-page ${className ?? ""}`} aria-label="Settings">
      {children}
    </section>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onClearAll,
  initialTab,
  returnFocusTarget,
  page = false,
  onSectionChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClearAll: () => void;
  initialTab?: string;
  onOpenHelp?: () => void;
  returnFocusTarget?: HTMLElement | null;
  page?: boolean;
  onSectionChange?: (section: string) => void;
}) {
  const Surface = page ? SettingsPageContent : DialogContent;
  const currentSectionHeadingId = useId();
  const pageUtilities = useContext(WorkspacePageUtilities);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusContextRef = useRef<{
    url: string;
    ownerId: string | null | undefined;
  } | null>(null);

  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = user?.id ?? null;
  const localUsage = open ? getUsage(userKey ?? undefined) : { images: 0, uploads: 0, date: "" };
  const currentAuthUserKeyRef = useRef<string | null | undefined>(undefined);
  currentAuthUserKeyRef.current = isLoaded ? userKey : undefined;
  const sharedSendOnEnter = useSharedSendOnEnter(user?.id ?? null);
  const clerk = useClerk();
  const loggedIn = !clerkEnabled || isSignedIn;
  const { tier } = useTier();
  const adaptiveMemoryUnlocked = tierRank(tier) >= 1;
  const normalizedInitialTab = initialTab === "subscription" ? "billing" : initialTab;
  const [tab, setTab] = useState<string>(normalizedInitialTab ?? "general");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [mobileHome, setMobileHome] = useState(true);
  const [usage, setUsage] = useState<DailyUsageDto | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageLoaded, setUsageLoaded] = useState(false);
  const [usageRetry, setUsageRetry] = useState(0);
  const usageStatusRef = useRef<HTMLDivElement>(null);
  const settingsSearchRef = useRef<HTMLInputElement>(null);
  const contentHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingMobileFocusRef = useRef<"content" | "navigation" | null>(null);
  const [mobileFocusRequest, setMobileFocusRequest] = useState(0);
  const [subSummary, setSubSummary] = useState<SubscriptionSummary | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  // UI-only lifetime: a closed dialog, changed tab or account cannot receive
  // late billing results or navigate from an abandoned portal request.
  const billingScopeRef = useRef({ open, userKey, tab, loggedIn, epoch: 0, view: 0 });
  const billingPendingRef = useRef(false);
  const portalPendingRef = useRef(false);
  const scope = billingScopeRef.current;
  if (
    scope.open !== open ||
    scope.userKey !== userKey ||
    scope.tab !== tab ||
    scope.loggedIn !== loggedIn
  ) {
    billingScopeRef.current = { open, userKey, tab, loggedIn, epoch: scope.epoch + 1, view: 0 };
    billingPendingRef.current = false;
    portalPendingRef.current = false;
  }
  const billingIsCurrent = (epoch: number) =>
    billingScopeRef.current.open && billingScopeRef.current.epoch === epoch;
  useEffect(
    () => () => {
      billingScopeRef.current.epoch += 1;
    },
    [],
  );
  const usageRetryEpoch = billingScopeRef.current.epoch;
  const usageRetryUrl = typeof window === "undefined" ? "" : window.location.href;
  const retryUsage = (event: React.MouseEvent<HTMLButtonElement>) => {
    const scope = billingScopeRef.current;
    const trigger = event.currentTarget;
    if (
      !billingIsCurrent(usageRetryEpoch) ||
      scope.tab !== "usage" ||
      !scope.loggedIn ||
      currentAuthUserKeyRef.current !== userKey ||
      usageRetryUrl !== window.location.href ||
      !trigger.isConnected ||
      trigger.closest('[inert], [aria-hidden="true"], [hidden]')
    )
      return;
    const status = usageStatusRef.current;
    // Move focus before Retry unmounts. Request completion never moves it again,
    // so a later interaction or navigation remains authoritative.
    if (
      (document.activeElement === trigger || document.activeElement === document.body) &&
      status?.isConnected &&
      status.getClientRects().length > 0 &&
      !status.closest('[inert], [aria-hidden="true"], [hidden]')
    )
      status.focus({ preventScroll: true });
    setUsageRetry((value) => value + 1);
  };
  useEffect(() => {
    setSubSummary(null);
    setSubscriptionError(null);
    setSubscriptionLoading(false);
    setPortalLoading(false);
  }, [open, userKey, tab, loggedIn]);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const deletionOperationRef = useRef(0);
  const [deletionStatus, setDeletionStatus] = useState<{
    ownerId: string;
    state: "active" | "scheduled" | "finalizing" | "deleted" | "unknown";
    scheduledAt?: string | null;
    recoverUntil?: string | null;
  } | null>(null);
  const deletionPending = deletionStatus?.ownerId === userKey && deletionStatus.state !== "active";
  const deletionScheduled =
    deletionStatus?.ownerId === userKey && deletionStatus.state === "scheduled";
  // A fast or slow browser clock must not decide recovery eligibility. The
  // scheduled server state offers the action; PostgreSQL enforces its deadline.
  const deletionRecoverable = deletionScheduled;
  const deletionDeadline =
    deletionStatus?.ownerId === userKey && typeof deletionStatus.recoverUntil === "string"
      ? new Date(deletionStatus.recoverUntil).toLocaleString()
      : null;
  useEffect(() => {
    deletionOperationRef.current++;
    setUsage(null);
    setUsageLoaded(false);
    setDeletionStatus(null);
    setDeleteAccountBusy(false);
    setDeleteAccountOpen(false);
    setDeleteConfirmation("");
  }, [userKey]);
  useEffect(() => {
    if (!open || !isLoaded || !userKey) return;
    const lifetime = new AbortController();
    const operation = deletionOperationRef.current;
    void requestAccountDeletion(userKey, "GET", lifetime.signal)
      .then(async (response) => {
        if (!response.ok) throw new Error("account_deletion_status_unavailable");
        const result = parseAccountDeletionStatus(await response.json());
        if (!result) throw new Error("account_deletion_status_unavailable");
        if (
          !lifetime.signal.aborted &&
          operation === deletionOperationRef.current &&
          currentAuthUserKeyRef.current === userKey
        )
          setDeletionStatus({ ownerId: userKey, ...result });
      })
      .catch(() => {
        /* A failed status read never claims deletion was rolled back. */
      });
    return () => lifetime.abort();
  }, [open, isLoaded, userKey]);

  const deleteAccountReturnRef = useRef<{
    target: HTMLButtonElement;
    url: string;
    ownerId: string | null;
  } | null>(null);
  useEffect(() => {
    // Account deletion controls remain bound to the account and section that opened them.
    setDeleteAccountOpen(false);
  }, [open, tab, userKey, isLoaded]);

  const [localResetBusy, setLocalResetBusy] = useState(false);
  const localResetBusyRef = useRef(false);
  const [localResetConfirmOpen, setLocalResetConfirmOpen] = useState(false);
  const localResetCancelRef = useRef<HTMLButtonElement>(null);
  const localResetScopeRef = useRef({
    open,
    tab,
    ownerId: currentAuthUserKeyRef.current,
    generation: 0,
  });
  const localResetConfirmationRef = useRef<{
    ownerId: string | null;
    generation: number;
    target: HTMLButtonElement;
    url: string;
  } | null>(null);
  const localResetReturnRef = useRef<typeof localResetConfirmationRef.current>(null);
  const resetScope = localResetScopeRef.current;
  if (
    resetScope.open !== open ||
    resetScope.tab !== tab ||
    resetScope.ownerId !== currentAuthUserKeyRef.current
  ) {
    localResetScopeRef.current = {
      open,
      tab,
      ownerId: currentAuthUserKeyRef.current,
      generation: resetScope.generation + 1,
    };
    // Returning to the same account or page cannot revive an earlier decision.
    localResetConfirmationRef.current = null;
  }
  const [clearMemoryConfirmOpen, setClearMemoryConfirmOpen] = useState(false);
  const [clearMemoryBusy, setClearMemoryBusy] = useState(false);

  useEffect(() => {
    if (!open || (tab !== "billing" && tab !== "usage") || !loggedIn) return;
    let cancelled = false;
    setUsageLoaded(false);
    setUsageLoading(true);
    getMyDailyUsage()
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      })
      .finally(() => {
        if (!cancelled) {
          setUsageLoading(false);
          setUsageLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, loggedIn, userKey, usageRetry]);

  useEffect(() => {
    if (!open || (tab !== "billing" && tab !== "usage") || !loggedIn) return;
    let cancelled = false;
    setSubSummary(null);
    setSubscriptionError(null);
    setSubscriptionLoading(true);
    const epoch = billingScopeRef.current.epoch;
    billingPendingRef.current = true;
    getSubscriptionSummary({ data: { environment: getStripeEnvironment() } })
      .then((summary) => {
        if (!cancelled && billingIsCurrent(epoch)) setSubSummary(summary);
      })
      .catch(() => {
        if (!cancelled && billingIsCurrent(epoch)) {
          setSubSummary(null);
          setSubscriptionError(
            "Billing details couldn't be verified. Select Refresh billing status to retry.",
          );
        }
      })
      .finally(() => {
        if (!cancelled && billingIsCurrent(epoch)) {
          billingPendingRef.current = false;
          setSubscriptionLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, loggedIn, userKey]);

  const handleManageBilling = async () => {
    if (
      !open ||
      !loggedIn ||
      portalPendingRef.current ||
      portalLoading ||
      !subSummary?.hasBillingAccount ||
      !subSummary.billingPortalAvailable
    )
      return;
    const epoch = billingScopeRef.current.epoch;
    const view = billingScopeRef.current.view;
    portalPendingRef.current = true;
    setPortalLoading(true);
    try {
      const res = await createPortalSession({ data: {} });
      if (!billingIsCurrent(epoch) || billingScopeRef.current.view !== view) return;
      if ("error" in res) throw new Error("billing_portal_unavailable");
      const portalUrl = parseAllowedBillingPortalUrl(res.url);
      if (!portalUrl) throw new Error("billing_portal_url_rejected");
      window.location.assign(portalUrl);
    } catch {
      if (!billingIsCurrent(epoch) || billingScopeRef.current.view !== view) return;
      toast.error("The billing portal couldn't be opened. Try again.");
    } finally {
      if (billingIsCurrent(epoch)) {
        portalPendingRef.current = false;
        setPortalLoading(false);
      }
    }
  };
  useEffect(() => {
    if (open && initialTab) {
      setTab(initialTab === "subscription" ? "billing" : initialTab);
      setMobileHome(false);
    }
    if (!open) {
      setSettingsQuery("");
      setMobileHome(true);
    }
  }, [open, initialTab]);

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

  const clearLocalBrowserData = async (
    targetUserKey: string | null | undefined = isLoaded ? userKey : undefined,
  ) => {
    const result = await resetPrincipalDeviceData(targetUserKey);
    if (!result.resolved) return result;
    const failureCount =
      result.local.failures.length +
      result.session.failures.length +
      result.imageHistory.failures.length +
      result.chatHistory.failures.length +
      result.pwa.failures.length;
    if (failureCount > 0) {
      console.warn("[local-data] Account-local browser cleanup was incomplete", {
        failureCount,
      });
    }
    return result;
  };

  const openLocalResetConfirmation = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const scope = localResetScopeRef.current;
    const ownerId = currentAuthUserKeyRef.current;
    if (
      localResetBusyRef.current ||
      deleteAccountOpen ||
      ownerId === undefined ||
      !scope.open ||
      scope.tab !== "storage"
    )
      return;
    const request = {
      ownerId,
      generation: scope.generation,
      target: event.currentTarget,
      url: window.location.href,
    };
    localResetConfirmationRef.current = request;
    localResetReturnRef.current = request;
    setLocalResetConfirmOpen(true);
  };

  const confirmLocalReset = async () => {
    const request = localResetConfirmationRef.current;
    const scope = localResetScopeRef.current;
    if (
      !request ||
      localResetBusyRef.current ||
      deleteAccountOpen ||
      !scope.open ||
      scope.tab !== "storage" ||
      request.generation !== scope.generation ||
      request.ownerId !== currentAuthUserKeyRef.current ||
      request.url !== window.location.href
    )
      return;
    // Consume the decision synchronously, before starting any local deletion.
    localResetConfirmationRef.current = null;
    setLocalResetConfirmOpen(false);
    const resetUserKey = request.ownerId;
    localResetBusyRef.current = true;
    setLocalResetBusy(true);
    try {
      const result = await clearLocalBrowserData(resetUserKey);
      if (!result.resolved) {
        toast.error("Account data is still loading. Try again in a moment.");
        return;
      }
      if (currentAuthUserKeyRef.current === resetUserKey) {
        onChange(DEFAULT_SETTINGS);
        onClearAll();
      }
      const failureCount =
        result.local.failures.length +
        result.session.failures.length +
        result.imageHistory.failures.length +
        result.chatHistory.failures.length +
        result.pwa.failures.length;
      if (failureCount > 0) {
        toast.warning("Some local data could not be reset. Reload and try again.");
      } else {
        toast.success("This profile's local browser data was reset.");
      }
    } catch {
      toast.warning("Some local data could not be reset. Reload and try again.");
    } finally {
      localResetBusyRef.current = false;
      setLocalResetBusy(false);
    }
  };

  const handleCheckDeletion = async () => {
    if (deleteAccountBusy || !isLoaded || !userKey) return;
    const deletionUserKey = userKey;
    const operation = ++deletionOperationRef.current;
    const currentDeletion = () =>
      currentAuthUserKeyRef.current === deletionUserKey &&
      deletionOperationRef.current === operation;
    setDeleteAccountBusy(true);
    try {
      const response = await requestAccountDeletion(deletionUserKey, "GET");
      const result = response.ok
        ? parseAccountDeletionStatus(await response.json().catch(() => null))
        : null;
      if (currentDeletion()) {
        setDeletionStatus(
          result
            ? { ownerId: deletionUserKey, ...result }
            : {
                ownerId: deletionUserKey,
                state: "unknown",
              },
        );
        if (!result)
          toast.error("Deletion status could not be verified. No local data was removed.");
      }
    } catch {
      if (currentDeletion()) {
        setDeletionStatus({ ownerId: deletionUserKey, state: "unknown" });
        toast.error("Deletion status could not be verified. No local data was removed.");
      }
    } finally {
      if (currentDeletion()) setDeleteAccountBusy(false);
    }
  };

  const handleRecoverAccount = async () => {
    if (
      deleteAccountBusy ||
      !isLoaded ||
      !userKey ||
      deletionStatus?.ownerId !== userKey ||
      deletionStatus.state !== "scheduled"
    )
      return;
    const deletionUserKey = userKey;
    const operation = ++deletionOperationRef.current;
    const currentDeletion = () =>
      currentAuthUserKeyRef.current === deletionUserKey &&
      deletionOperationRef.current === operation;
    setDeleteAccountBusy(true);
    try {
      const response = await requestAccountDeletion(deletionUserKey, "PATCH");
      const body = await response.json().catch(() => null);
      const result = response.status === 200 ? parseAccountDeletionStatus(body) : null;
      if (!currentDeletion()) return;
      setDeletionStatus(
        result
          ? { ownerId: deletionUserKey, ...result }
          : {
              ownerId: deletionUserKey,
              state: "unknown",
            },
      );
      if (result?.state === "active") {
        setDeleteAccountOpen(false);
        setDeleteConfirmation("");
        toast.success(
          "Your account was recovered. Your data, subscription and discount are unchanged.",
        );
        if (body?.emailNotification === "unconfirmed")
          toast.warning(
            "Your account was recovered, but we couldn’t confirm its email notification.",
          );
      } else {
        toast.error(
          "Account recovery was not confirmed. Check deletion status; billing is unchanged.",
        );
      }
    } catch {
      if (currentDeletion()) {
        setDeletionStatus({ ownerId: deletionUserKey, state: "unknown" });
        toast.error(
          "Account recovery was not confirmed. Check deletion status; no local data was removed.",
        );
      }
    } finally {
      if (currentDeletion()) setDeleteAccountBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE" || deleteAccountBusy || !isLoaded || !userKey) return;
    const deletionUserKey = userKey;
    const operation = ++deletionOperationRef.current;
    const currentDeletion = () =>
      currentAuthUserKeyRef.current === deletionUserKey &&
      deletionOperationRef.current === operation;
    setDeleteAccountBusy(true);
    let response: Response;
    try {
      response = await requestAccountDeletion(deletionUserKey, "DELETE");
    } catch (error) {
      console.error("[account-delete] request failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      if (currentDeletion()) {
        setDeletionStatus({ ownerId: deletionUserKey, state: "unknown" });
        toast.error(
          "Your deletion request may have been scheduled. Check its status; no local data was removed.",
        );
        setDeleteAccountBusy(false);
      }
      return;
    }

    if (!response.ok) {
      const result = parseAccountDeletionStatus(await response.json().catch(() => null));
      if (currentDeletion()) {
        setDeletionStatus(
          result
            ? { ownerId: deletionUserKey, ...result }
            : {
                ownerId: deletionUserKey,
                state: "unknown",
              },
        );
        toast.error(
          response.status === 401
            ? "Your sign-in is no longer valid. Deletion may have completed. Sign in again only if the account still exists to check its status; completed cleanup cannot be undone."
            : "Deletion was not confirmed. Check its status; no local data was removed.",
        );
        setDeleteAccountBusy(false);
      }
      return;
    }

    if (response.status !== 204) {
      const body = await response.json().catch(() => null);
      const result = parseAccountDeletionStatus(body);
      if (currentDeletion()) {
        setDeletionStatus(
          result
            ? { ownerId: deletionUserKey, ...result }
            : {
                ownerId: deletionUserKey,
                state: "unknown",
              },
        );
        if (response.status === 202 && result?.state === "scheduled") {
          setDeleteAccountOpen(false);
          setDeleteConfirmation("");
          toast.success(
            "Account deletion is scheduled after 30 days. Recover before the deadline in Data controls. Billing is unchanged; cancel separately in Billing if needed.",
          );
          if (body?.emailNotification === "unconfirmed")
            toast.warning(
              "Deletion is scheduled. We couldn’t confirm its email notification; check the recovery deadline in Data controls.",
            );
        } else {
          toast.error("Deletion is pending or unverified. No local data was removed.");
        }
        setDeleteAccountBusy(false);
      }
      return;
    }

    // Only a verified final 204 means server deletion is complete. Scheduling
    // and recovery never clear data or sign out. Local UI,
    // storage, or sign-out failures may require browser cleanup, but must never
    // be reported as though the account remains active.
    let localCleanupIncomplete: boolean;
    try {
      const cleanupResult = await clearLocalBrowserData(deletionUserKey);
      if (currentAuthUserKeyRef.current === deletionUserKey) {
        onClearAll();
        setDeleteAccountOpen(false);
        onOpenChange(false);
      }
      const cleanupFailureCount =
        cleanupResult.local.failures.length +
        cleanupResult.session.failures.length +
        cleanupResult.imageHistory.failures.length +
        cleanupResult.chatHistory.failures.length +
        cleanupResult.pwa.failures.length;
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
      if (currentDeletion()) setDeleteAccountBusy(false);
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
    if (
      !open ||
      !loggedIn ||
      billingPendingRef.current ||
      subscriptionLoading ||
      portalPendingRef.current ||
      portalLoading
    )
      return;
    const epoch = billingScopeRef.current.epoch;
    billingPendingRef.current = true;
    setSubscriptionLoading(true);
    setSubscriptionError(null);
    try {
      const summary = await getSubscriptionSummary({
        data: { environment: getStripeEnvironment() },
      });
      if (!billingIsCurrent(epoch)) return;
      setSubSummary(summary);
      if (summary.billingConflict) {
        toast.error("A billing conflict needs support review.");
      } else if (summary.effectiveTier === "free") {
        toast.message("No active subscription found on this account.");
      } else {
        toast.success(`${summary.effectiveTier === "pro" ? "Pro" : "Plus"} plan refreshed.`);
      }
    } catch {
      if (!billingIsCurrent(epoch)) return;
      setSubSummary(null);
      setSubscriptionError(
        "Billing details couldn't be verified. Select Refresh billing status to retry.",
      );
      toast.error("Couldn't check your subscription. Try again.");
    } finally {
      if (billingIsCurrent(epoch)) {
        billingPendingRef.current = false;
        setSubscriptionLoading(false);
      }
    }
  };

  const familyTierUpgrade =
    !!subSummary &&
    !subSummary.billingConflict &&
    tierRank(subSummary.effectiveTier) > tierRank(subSummary.tier);
  const inheritedSubscription = familyTierUpgrade && subSummary.activeSubscriptionCount === 0;
  const ownSubscriptionWithFamilyUpgrade =
    familyTierUpgrade && subSummary.activeSubscriptionCount > 0;
  const displayedSubscriptionTier = subSummary?.effectiveTier;

  // "Saved" indicator: whenever settings change while the dialog is open, show
  // a subtle pill for ~1.5s. Skips the very first render so it doesn't fire on
  // open.
  const [savedPulse, setSavedPulse] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saved = (event: Event) => {
      if ((event as CustomEvent<{ ownerId: string | null }>).detail?.ownerId !== userKey) return;
      setSavedPulse(true);
      clearTimeout(timer);
      timer = setTimeout(() => setSavedPulse(false), 1500);
    };
    window.addEventListener("kova:settings-saved", saved);
    return () => {
      window.removeEventListener("kova:settings-saved", saved);
      clearTimeout(timer);
    };
  }, [open, userKey]);

  const pageGroups: TabGroup[] = [
    {
      title: "Settings",
      tabs: [
        { v: "personalization", label: "Profile", icon: User2 },
        { v: "appearance", label: "Appearance", icon: Palette },
        { v: "general", label: "Responses", icon: Sparkles },
        { v: "notifications", label: "Notifications", icon: Bell },
        { v: "linked", label: "Connections", icon: Link2 },
        { v: "data", label: "Privacy", icon: ShieldCheck },
        { v: "usage", label: "Usage", icon: BarChart3 },
        { v: "billing", label: "Billing", icon: CreditCard },
      ],
    },
  ];
  const groups = pageGroups;
  const secondaryParents: Record<string, string> = {
    email: "personalization",
    logout: "personalization",
    report: "personalization",
    help: "personalization",
    about: "personalization",
    shortcuts: "general",
    memory: "data",
    security: "data",
    storage: "data",
    location: "data",
    parental: "data",
    family: "linked",
  };
  const parentTab = secondaryParents[tab];
  const secondaryTabs = TAB_GROUPS.flatMap((group) => group.tabs).filter(
    (item) =>
      secondaryParents[item.v] === tab && !["memory", "security", "storage"].includes(item.v),
  );
  const allTabs = groups.flatMap((group) => group.tabs);
  const activeTab =
    allTabs.find((item) => item.v === tab) ??
    TAB_GROUPS.flatMap((group) => group.tabs).find((item) => item.v === tab) ??
    allTabs[0];
  const normalizedQuery = settingsQuery.trim().toLocaleLowerCase();
  const matchesSettingsQuery = (item: TabDef) =>
    [item.label, ...(item.keywords ?? [])].some((term) =>
      term.toLocaleLowerCase().includes(normalizedQuery),
    );
  const matchingSecondaryTabs = normalizedQuery
    ? TAB_GROUPS.flatMap((group) => group.tabs).filter(
        (item) => secondaryParents[item.v] && matchesSettingsQuery(item),
      )
    : [];
  const hasSettingsMatches =
    !normalizedQuery ||
    groups.some((group) => group.tabs.some(matchesSettingsQuery)) ||
    matchingSecondaryTabs.length > 0;
  const filteredGroups = normalizedQuery
    ? [
        ...groups.map((group) => ({
          ...group,
          tabs: group.tabs.filter((item) => item.v === tab || matchesSettingsQuery(item)),
        })),
        { title: "Related settings", tabs: matchingSecondaryTabs },
      ].filter((group) => group.tabs.length > 0)
    : groups;
  const selectTab = (value: string) => {
    pendingMobileFocusRef.current = "content";
    setTab(value);
    if (page) onSectionChange?.(settingsSectionForTab(value));
    setMobileHome(false);
    setSettingsQuery("");
    setMobileFocusRequest((request) => request + 1);
  };
  useEffect(() => {
    const pendingFocus = pendingMobileFocusRef.current;
    if (!pendingFocus) return;
    pendingMobileFocusRef.current = null;
    if (pendingFocus === "navigation" && mobileHome) {
      settingsSearchRef.current?.focus();
    } else if (pendingFocus === "content" && !mobileHome) {
      contentHeadingRef.current?.focus();
    }
  }, [mobileFocusRequest, mobileHome, tab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Surface
        closeLabel="Close settings"
        className={`kova-settings-dialog kova-settings-reference ${loggedIn ? "is-authenticated" : "is-guest"} bg-[var(--surface-modal)] text-[var(--popover-foreground)] border border-border overflow-hidden flex flex-col gap-0 p-0`}
        onOpenAutoFocus={() => {
          // Capture once per opening, before the dialog moves focus. Navigating
          // Settings sections must not replace the original external invoker.
          returnFocusRef.current =
            returnFocusTarget ??
            (document.activeElement instanceof HTMLElement ? document.activeElement : null);
          returnFocusContextRef.current = {
            url: window.location.href,
            ownerId: currentAuthUserKeyRef.current,
          };
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const previous = returnFocusRef.current;
          const context = returnFocusContextRef.current;
          returnFocusRef.current = null;
          returnFocusContextRef.current = null;
          if (
            !context ||
            context.url !== window.location.href ||
            context.ownerId !== currentAuthUserKeyRef.current
          )
            return;

          // Radix delivers this after unmount. A new page, modal or subsequent
          // interaction owns its own focus, even if the invoker still exists.
          const current = document.activeElement;
          const closingDialog = event.target;
          if (
            current?.isConnected &&
            current !== document.body &&
            !(closingDialog instanceof HTMLElement && closingDialog.contains(current))
          )
            return;
          const activeModal = document.querySelector<HTMLElement>(
            '[aria-modal="true"]:not([data-state="closed"]), dialog[open]',
          );
          if (activeModal && activeModal !== closingDialog) return;

          const restore = (target: HTMLElement | null) => {
            if (
              !target?.isConnected ||
              target === document.body ||
              target === document.documentElement ||
              !target.getClientRects().length ||
              target.closest('[inert], [aria-hidden="true"], [hidden]') ||
              target.matches(":disabled") ||
              window.getComputedStyle(target).visibility !== "visible"
            )
              return false;
            target.focus({ preventScroll: true });
            return document.activeElement === target;
          };
          // A desktop menu item unmounts when Settings opens; its account
          // trigger remains available. A closed mobile drawer instead restores
          // its visible menu opener. Both fallbacks use the same focus guards.
          if (
            !restore(previous) &&
            !restore(document.querySelector<HTMLElement>('[aria-label="Account menu"]'))
          )
            restore(document.querySelector<HTMLElement>('[aria-label="Open menu"]'));
        }}
      >
        <DialogHeader
          className={`${page ? "kova-settings-page-header" : "px-5 sm:px-7"} pt-5 pb-4 border-b border-border ${loggedIn && !page ? "hidden" : ""}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="kova-settings-main-title text-xl font-semibold tracking-tight font-display">
                Settings
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {loggedIn
                  ? "Preferences save automatically, except forms with Save changes."
                  : "Appearance and preferences for this browser."}
              </p>
            </div>
            {page ? pageUtilities : null}
            {loggedIn && !page && (
              <div
                aria-live="polite"
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors duration-100 ${
                  savedPulse
                    ? "opacity-100 translate-y-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "opacity-0 -translate-y-1 border-transparent bg-transparent text-transparent pointer-events-none"
                }`}
              >
                <Check className="inline w-3 h-3 mr-1 -mt-0.5" />
                Updated
              </div>
            )}
          </div>
        </DialogHeader>

        {!loggedIn ? (
          <SignedOutSettings
            settings={settings}
            setMode={setMode}
            onSignIn={() => clerk?.openSignIn()}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <Tabs
            value={tab}
            onValueChange={selectTab}
            orientation="vertical"
            className="flex-1 overflow-hidden flex flex-col md:flex-row"
          >
            {page ? (
              <label className="kova-settings-section-select">
                Section
                <SearchablePicker
                  aria-label="Section"
                  className="kova-native-select"
                  value={tab}
                  onValueChange={selectTab}
                  searchLabel="Search sections"
                  emptyText="No sections found."
                  restoreFocusOnSelect={false}
                  options={[
                    ...allTabs.map((item) => ({ value: item.v, label: item.label })),
                    ...(!allTabs.some((item) => item.v === tab)
                      ? [{ value: tab, label: activeTab.label }]
                      : []),
                  ]}
                />
              </label>
            ) : null}
            <aside
              className={`kova-settings-sidebar ${mobileHome ? "mobile-home" : "mobile-hidden"}`}
              aria-label="Settings navigation"
            >
              <div className="kova-settings-sidebar-top" aria-hidden="true" />
              <label className="kova-settings-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Search settings</span>
                <input
                  ref={settingsSearchRef}
                  value={settingsQuery}
                  onChange={(event) => setSettingsQuery(event.target.value)}
                  placeholder="Search settings"
                />
              </label>
              <TabsList className="kova-settings-nav" aria-orientation="vertical">
                {filteredGroups.map((group) => (
                  <section key={group.title} aria-label={group.title}>
                    <p className="kova-settings-nav-group">{group.title}</p>
                    {group.tabs.map(({ v, icon: Icon, label }) => (
                      <TabsTrigger
                        key={v}
                        value={v}
                        className="kova-settings-nav-item"
                        onClick={() => {
                          // An already-selected Radix tab does not emit onValueChange.
                          if (mobileHome && v === tab) selectTab(v);
                        }}
                      >
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </TabsTrigger>
                    ))}
                  </section>
                ))}
                {!hasSettingsMatches ? (
                  <p className="kova-settings-no-results" role="status">
                    No settings found
                  </p>
                ) : null}
              </TabsList>
            </aside>

            <div
              className={`kova-settings-content flex-1 overflow-hidden flex flex-col ${mobileHome ? "mobile-hidden" : "mobile-content"}`}
            >
              <header className="kova-settings-content-header">
                <button
                  type="button"
                  className={`kova-settings-back ${page ? "hidden" : ""}`}
                  aria-label="Back to settings"
                  onClick={() => {
                    pendingMobileFocusRef.current = "navigation";
                    setMobileHome(true);
                    setMobileFocusRequest((request) => request + 1);
                  }}
                >
                  <ArrowLeft aria-hidden="true" />
                </button>
                <div>
                  <h2 id={currentSectionHeadingId} ref={contentHeadingRef} tabIndex={-1}>
                    {activeTab.label}
                  </h2>
                </div>
                <span
                  aria-live="polite"
                  className={savedPulse ? "kova-settings-saved visible" : "kova-settings-saved"}
                >
                  <Check aria-hidden="true" />
                  Updated
                </span>
              </header>
              {parentTab ? (
                <div className="px-7 py-2">
                  <Button variant="ghost" onClick={() => selectTab(parentTab)}>
                    <ArrowLeft aria-hidden="true" />
                    Back to {allTabs.find((item) => item.v === parentTab)?.label ?? "Settings"}
                  </Button>
                </div>
              ) : secondaryTabs.length ? (
                <details className="mx-7 my-2 rounded-[var(--kova-radius-card)] border border-border px-4">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm">
                    More {activeTab.label.toLocaleLowerCase()} settings
                  </summary>
                  <div className="flex flex-wrap gap-2 pb-4">
                    {secondaryTabs.map((item) => (
                      <Button key={item.v} variant="outline" onClick={() => selectTab(item.v)}>
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </details>
              ) : null}
              {/* GENERAL */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="general"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <section className="space-y-4">
                  <h3 className="text-sm font-semibold">Response defaults</h3>
                  <p className="text-sm text-muted-foreground">
                    These preferences save for this account on this device. Explicit instructions in
                    the current chat take precedence over default length, tone, and format.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-2">
                      Format
                      <select
                        className="kova-native-select"
                        value={settings.responseFormat}
                        onChange={(e) =>
                          onChange({
                            ...settings,
                            responseFormat: e.target.value as Settings["responseFormat"],
                          })
                        }
                      >
                        <option value="automatic">Automatic</option>
                        <option value="plain">Plain text</option>
                        <option value="markdown">Markdown</option>
                      </select>
                    </label>
                    <label className="grid gap-2">
                      Tone
                      <select
                        className="kova-native-select"
                        value={settings.responseTone}
                        onChange={(e) =>
                          onChange({
                            ...settings,
                            responseTone: e.target.value as Settings["responseTone"],
                          })
                        }
                      >
                        <option value="direct">Direct</option>
                        <option value="formal">Formal</option>
                        <option value="conversational">Conversational</option>
                      </select>
                    </label>
                  </div>
                  <div className="kova-settings-reference-group">
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
                    <div className="kova-settings-reference-row">
                      <label htmlFor="settings-response-length" className="text-sm">
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
                        <SelectTrigger
                          id="settings-response-length"
                          aria-label="Preferred response length"
                          className="kova-settings-reference-select"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="short">Concise</SelectItem>
                          <SelectItem value="medium">Standard (default)</SelectItem>
                          <SelectItem value="long">Detailed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Custom instructions and personality</h3>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Additional response style
                    </label>
                    <Select
                      value={settings.mood}
                      onValueChange={(v) => onChange({ ...settings, mood: v as Mood })}
                    >
                      <SelectTrigger aria-label="Additional response style">
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
                  <p id="settings-instruction-scope" className="text-sm text-muted-foreground">
                    Applies to normal chats for this account in this browser. These instructions are
                    separate from project instructions, which you edit in the project. Temporary
                    Chat excludes custom instructions and personality preferences. Explicit
                    instructions in your current chat take precedence.
                  </p>
                  <div>
                    <label
                      htmlFor="settings-custom-instructions"
                      className="text-xs text-muted-foreground mb-1 block"
                    >
                      Custom instructions for this account on this device
                    </label>
                    <textarea
                      id="settings-custom-instructions"
                      rows={4}
                      aria-describedby="settings-instruction-scope"
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
                  <div>
                    <label
                      htmlFor="settings-extra-facts"
                      className="text-xs text-muted-foreground mb-1 block"
                    >
                      Anything KovaGPT should know about you
                    </label>
                    <textarea
                      id="settings-extra-facts"
                      rows={4}
                      placeholder="e.g. I'm a student in Chicago. I prefer metric. I'm learning Python."
                      value={settings.extraFacts}
                      onChange={(e) => onChange({ ...settings, extraFacts: e.target.value })}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y min-h-[90px]"
                    />
                  </div>
                </section>

                <section className="space-y-3">
                  <PersonalitySliders userKey={userKey} principalResolved={isLoaded} />
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Device activity hints</h3>
                  <p className="text-sm text-muted-foreground">
                    These browser counters are not your account allowance. Open Usage for
                    server-verified counts.
                  </p>
                  <div className="kova-settings-reference-group text-sm">
                    <div className="kova-settings-reference-row">
                      <span className="text-muted-foreground">Images generated</span>
                      <span>{localUsage.images}</span>
                    </div>
                    <div className="kova-settings-reference-row">
                      <span className="text-muted-foreground">Images uploaded</span>
                      <span>{localUsage.uploads}</span>
                    </div>
                  </div>
                </section>
                <WorkspaceDefaults userKey={userKey} principalResolved={isLoaded} />
              </TabsContent>

              {/* PROFILE */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="personalization"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <ProfileSettings
                  user={user}
                  principalResolved={isLoaded}
                  settings={settings}
                  onChange={onChange}
                />
              </TabsContent>

              {/* MEMORY */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="memory"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4" />
                    {!page ? <h3 className="text-sm font-semibold">Memory</h3> : null}
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground">
                      Plus
                    </span>
                  </div>
                  {adaptiveMemoryUnlocked ? (
                    <>
                      <ToggleRow
                        title="Use saved memory"
                        hint="Use existing saved memories and bounded summaries within the same non-temporary chat. New cross-chat preferences require Save a reviewed memory from a response in an eligible synced chat. This browser has its own setting."
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
                          Paid plans can use existing saved memories and bounded summaries within
                          the same non-temporary chat.
                        </div>
                        <Link
                          to="/pricing"
                          onClick={() => onOpenChange(false)}
                          className="kova-button inline-flex items-center gap-1.5 text-xs font-medium mt-3 px-3 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition"
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
                      Permanently delete saved account memories and same-chat summaries. Chats,
                      drafts, and preferences saved in this browser are not deleted. Memory is
                      turned off in this browser before deletion so a pending summary cannot
                      recreate the deleted data.
                    </p>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <Link
                      to="/memory"
                      onClick={() => onOpenChange(false)}
                      className="kova-button inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open Memory Center
                    </Link>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setClearMemoryConfirmOpen(true)}
                      disabled={clearMemoryBusy || !isSignedIn}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {clearMemoryBusy ? "Deleting…" : "Delete saved memory"}
                    </Button>
                  </div>
                </section>
              </TabsContent>

              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="linked"
                className="overflow-y-auto px-7 pb-8 space-y-5 py-5"
              >
                {!loggedIn ? (
                  <SignInGate label="Apps" />
                ) : (
                  <section className="space-y-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">Connected apps</h3>
                      <p className="text-xs text-muted-foreground">
                        Connection status, provider permissions, reconnection, and revocation are
                        verified from the server-backed Apps page.
                      </p>
                    </div>
                    <Button asChild variant="outline" className="min-h-11">
                      <Link to="/apps" onClick={() => onOpenChange(false)}>
                        Manage apps and permissions
                      </Link>
                    </Button>
                  </section>
                )}
              </TabsContent>

              {/* LIBRARY */}
              {/* Library and Finances tabs intentionally removed from Settings. */}

              {/* EMAIL */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="email"
                className="overflow-y-auto px-7 pb-8 space-y-4 py-5"
              >
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

              {/* USAGE */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="usage"
                className="overflow-y-auto px-7 pb-8 space-y-7 py-6"
              >
                <section className="space-y-3">
                  <h3>Plan limits</h3>
                  <p className="text-sm text-muted-foreground">
                    Daily activity shared across KovaGPT chat, image generation, and file uploads.
                  </p>
                  <div
                    ref={usageStatusRef}
                    className="kova-settings-usage-summary"
                    role="region"
                    aria-label="Usage status"
                    tabIndex={-1}
                    aria-busy={usageLoading}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm">Today's usage</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {usage
                            ? `Resets ${formatDisplayDateTime(usage.resetsAt, settings.timeFormat, { dateStyle: "medium", timeStyle: "short" })} (device time zone). Accounting resets at midnight UTC.`
                            : "Daily counters reset at midnight UTC."}
                        </p>
                      </div>
                      {subSummary?.effectiveTier && (
                        <span className="kova-settings-current-plan">
                          {subSummary.effectiveTier === "free"
                            ? "Free"
                            : subSummary.effectiveTier === "plus"
                              ? "Plus"
                              : "Pro"}
                        </span>
                      )}
                    </div>
                    {(!usageLoaded || usageLoading) && !usage ? (
                      <div className="kova-settings-skeleton" role="status">
                        Loading usage…
                      </div>
                    ) : usage ? (
                      <dl className="kova-settings-reference-metrics">
                        <div>
                          <dt>Messages</dt>
                          <dd>{usage.chats}</dd>
                        </div>
                        <div>
                          <dt>Images</dt>
                          <dd>
                            {usage.images}
                            {tier === "free"
                              ? ` / ${DAILY_IMAGE_LIMIT} used · ${Math.max(0, DAILY_IMAGE_LIMIT - usage.images)} remaining`
                              : " used"}
                          </dd>
                        </div>
                        <div>
                          <dt>File uploads</dt>
                          <dd>
                            {usage.uploads}
                            {tier === "free"
                              ? ` / ${DAILY_UPLOAD_LIMIT} used · ${Math.max(0, DAILY_UPLOAD_LIMIT - usage.uploads)} remaining`
                              : " used"}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <div className="kova-settings-inline-error" role="alert">
                        <p>Usage data isn't available right now.</p>
                        <button type="button" className="min-h-11" onClick={retryUsage}>
                          Retry usage
                        </button>
                      </div>
                    )}
                  </div>
                </section>
                <section className="kova-settings-section">
                  <h3>How limits work</h3>
                  <p className="text-sm text-muted-foreground">
                    Your current allowance is enforced by KovaGPT when you use a limited feature.
                    Exact percentage progress is not shown because the service does not currently
                    provide an account allowance total.
                  </p>
                  <Link
                    to="/pricing"
                    onClick={() => onOpenChange(false)}
                    className="mt-4 inline-flex min-h-11 items-center font-medium underline underline-offset-4"
                  >
                    Compare Kova plans
                  </Link>
                </section>
              </TabsContent>

              {/* BILLING */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="billing"
                className="kova-billing-details kova-adapted-controls overflow-y-auto px-7 pb-8 space-y-5 py-5"
              >
                <BillingWorkspace
                  key={`${userKey}:${open}`}
                  timeFormat={settings.timeFormat}
                  summary={subSummary}
                  loading={subscriptionLoading}
                  error={subscriptionError}
                  loggedIn={loggedIn}
                  portalLoading={portalLoading}
                  inheritedSubscription={inheritedSubscription}
                  onManage={handleManageBilling}
                  onNavigate={() => onOpenChange(false)}
                  onViewChange={() => {
                    billingScopeRef.current.view += 1;
                  }}
                >
                  <section
                    className="kova-billing-section kova-billing-plan-section"
                    aria-labelledby="billing-plan-heading"
                    aria-busy={subscriptionLoading}
                  >
                    <div className="kova-billing-plan-summary">
                      <div>
                        <h3 id="billing-plan-heading" className="kova-billing-plan-title">
                          {subscriptionLoading
                            ? "Checking your plan"
                            : subscriptionError || subSummary?.billingConflict
                              ? "Plan needs review"
                              : displayedSubscriptionTier
                                ? `KovaGPT ${displayedSubscriptionTier === "free" ? "Free" : displayedSubscriptionTier === "plus" ? "Plus" : "Pro"}`
                                : "Your KovaGPT plan"}
                        </h3>
                        {subscriptionLoading ? (
                          <div className="kova-billing-copy">Checking billing status…</div>
                        ) : subscriptionError ? (
                          <div className="kova-billing-copy text-destructive">
                            Billing details unavailable.
                          </div>
                        ) : subSummary?.billingConflict ? (
                          <div className="kova-billing-copy text-destructive" role="alert">
                            Multiple or unrecognized active subscriptions were detected. Contact
                            support@kovagpt.com to review the billing records.
                          </div>
                        ) : displayedSubscriptionTier ? (
                          <div className="kova-billing-copy">
                            You're on the{" "}
                            {displayedSubscriptionTier === "free"
                              ? "Free"
                              : displayedSubscriptionTier === "plus"
                                ? "Plus"
                                : "Pro"}{" "}
                            plan
                            {familyTierUpgrade ? " through Family Sharing" : ""}
                            {subSummary?.trialing ? " (free trial)" : ""}
                            {subSummary?.status === "past_due" ? " - payment past due" : ""}
                            {subSummary?.status === "unpaid" ? " - payment failed" : ""}
                            {subSummary?.status === "incomplete" ? " - awaiting first payment" : ""}
                            .
                          </div>
                        ) : !loggedIn ? (
                          <p className="kova-billing-copy">
                            Sign in to see your plan and billing details.
                          </p>
                        ) : null}
                        {ownSubscriptionWithFamilyUpgrade && (
                          <div className="kova-billing-copy kova-billing-plan-note">
                            Your own {subSummary?.tier === "pro" ? "Pro" : "Plus"} subscription is
                            still billed and can be managed below.
                          </div>
                        )}
                        {subSummary?.currentPeriodEnd &&
                          !subscriptionLoading &&
                          !subscriptionError &&
                          !subSummary.billingConflict &&
                          new Date(subSummary.currentPeriodEnd).getTime() > Date.now() &&
                          (subSummary.cancelAtPeriodEnd ||
                            ["active", "trialing"].includes(subSummary.status ?? "")) &&
                          !inheritedSubscription && (
                            <div className="kova-billing-copy kova-billing-plan-note">
                              {subSummary.cancelAtPeriodEnd
                                ? `Cancels on ${formatDisplayDateTime(subSummary.currentPeriodEnd, settings.timeFormat, { dateStyle: "medium", timeStyle: "short" })}. You keep access until then.`
                                : subSummary.trialing
                                  ? `Trial ends ${formatDisplayDateTime(subSummary.currentPeriodEnd, settings.timeFormat, { dateStyle: "medium", timeStyle: "short" })} - billing starts then unless you cancel.`
                                  : `Renews on ${formatDisplayDateTime(subSummary.currentPeriodEnd, settings.timeFormat, { dateStyle: "medium", timeStyle: "short" })}.`}
                            </div>
                          )}
                      </div>
                      {!subscriptionLoading &&
                        !subscriptionError &&
                        displayedSubscriptionTier === "free" &&
                        !subSummary?.billingConflict &&
                        !subSummary?.hasBillingAccount && (
                          <Link
                            to="/pricing"
                            onClick={() => onOpenChange(false)}
                            className="kova-billing-view-plans inline-flex items-center gap-2 text-sm"
                          >
                            View plans <ExternalLink className="w-4 h-4" aria-hidden="true" />
                          </Link>
                        )}
                    </div>
                    <BillingSubscriptionFacts
                      timeFormat={settings.timeFormat}
                      summary={subSummary}
                      loading={subscriptionLoading}
                      error={subscriptionError}
                      loggedIn={loggedIn}
                      portalLoading={portalLoading}
                      inheritedSubscription={inheritedSubscription}
                      onManage={handleManageBilling}
                    />
                  </section>

                  <section
                    className="kova-billing-section kova-billing-usage-section"
                    aria-labelledby="billing-usage-heading"
                    aria-busy={usageLoading}
                  >
                    <div className="kova-billing-section-heading">
                      <h3 id="billing-usage-heading">Usage today</h3>
                      {usage && (
                        <span className="kova-billing-reset">
                          Resets{" "}
                          {formatDisplayDateTime(usage.resetsAt, settings.timeFormat, {
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
                      <>
                        <dl className="kova-billing-metrics">
                          <div>
                            <dt>Messages used</dt>
                            <dd>{usage.chats}</dd>
                          </div>
                          <div>
                            <dt>Images used</dt>
                            <dd>{usage.images}</dd>
                          </div>
                          <div>
                            <dt>File uploads used</dt>
                            <dd>{usage.uploads}</dd>
                          </div>
                        </dl>
                        <p className="kova-billing-usage-note">
                          Daily counts are shown here. Account allowance totals aren’t currently
                          available.
                        </p>
                      </>
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
                  </section>

                  <section
                    className="kova-billing-section kova-billing-management"
                    aria-labelledby="billing-management-heading"
                  >
                    <div className="kova-billing-management-row">
                      <div className="kova-billing-management-copy">
                        <h3 id="billing-management-heading">Payment</h3>
                        <p
                          id="billing-management-status"
                          role={subscriptionError ? "alert" : undefined}
                          className={`kova-billing-management-status ${subscriptionError ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {subscriptionError
                            ? subscriptionError
                            : subscriptionLoading
                              ? "Checking the billing account linked to this KovaGPT account."
                              : subSummary?.billingConflict
                                ? "A billing conflict was detected. Contact support@kovagpt.com so the subscriptions can be reconciled."
                                : inheritedSubscription
                                  ? "This shared plan is managed by the Family Sharing owner."
                                  : subSummary?.hasBillingAccount &&
                                      subSummary.billingPortalAvailable
                                    ? "Manage payment methods, invoices, account details, and cancellation. Opens the external Stripe billing portal in this tab."
                                    : subSummary?.hasBillingAccount
                                      ? "A Stripe billing account is linked, but the self-service portal is not configured. Contact support@kovagpt.com for billing help."
                                      : "No Stripe billing account is linked to this KovaGPT account."}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleManageBilling}
                        className="kova-billing-manage-button"
                        disabled={
                          portalLoading ||
                          subscriptionLoading ||
                          !!subscriptionError ||
                          !subSummary?.hasBillingAccount ||
                          !subSummary.billingPortalAvailable ||
                          inheritedSubscription
                        }
                        aria-describedby="billing-management-status"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                        {portalLoading ? "Opening…" : "Manage subscription"}
                      </Button>
                    </div>
                    <div className="kova-billing-management-row">
                      <span className="kova-billing-row-label">Billing status</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRestore}
                        className="kova-billing-refresh-button aria-disabled:opacity-50 aria-disabled:cursor-wait"
                        aria-disabled={subscriptionLoading || portalLoading}
                        aria-busy={subscriptionLoading}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                        {subscriptionLoading ? "Checking…" : "Refresh billing status"}
                      </Button>
                    </div>
                  </section>

                  {subSummary?.hasBillingAccount &&
                    !inheritedSubscription &&
                    displayedSubscriptionTier !== "free" && (
                      <section className="kova-billing-secondary-section">
                        <h3>Cancel subscription</h3>
                        <p className="text-xs text-muted-foreground">
                          {subSummary.billingPortalAvailable
                            ? "Review cancellation in the external Stripe billing portal above. Check the actual access-end date and any charges before confirming. Resume subscription is only available if Stripe offers it."
                            : "The self-service billing portal is not configured. Contact support@kovagpt.com for cancellation or other billing help."}
                        </p>
                      </section>
                    )}

                  <section className="kova-billing-secondary-section">
                    <h3>Account and data deletion</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Use Privacy and data to schedule deletion after a 30-day recovery window.
                      Scheduling and recovery keep your subscription and discount unchanged; use
                      Billing to cancel separately. For help or a specific privacy request, contact{" "}
                      <a
                        href="mailto:support@kovagpt.com"
                        className="underline hover:text-foreground"
                      >
                        support@kovagpt.com
                      </a>{" "}
                      from the email connected to your account. Some billing, security, and backup
                      records may be retained when required by law or operational policy.
                    </p>
                  </section>

                  <nav className="kova-billing-help-links" aria-label="Billing help and policies">
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
                  </nav>

                  <p className="kova-billing-security-note">
                    <Lock aria-hidden="true" />
                    Payments are securely handled by Stripe. We never see or store your card number.
                  </p>
                </BillingWorkspace>
              </TabsContent>

              {/* APPEARANCE */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="appearance"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <AppearanceSettings settings={settings} onChange={onChange} />
              </TabsContent>

              {/* NOTIFICATIONS */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="notifications"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                {!page ? <h3 className="text-sm font-semibold">Notifications</h3> : null}
                <PwaSettings ownerId={isLoaded ? userKey : null} />
                <AccountEmailPreferences ownerId={isLoaded ? userKey : null} />
              </TabsContent>

              {/* PARENTAL */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="parental"
                className="overflow-y-auto px-7 pb-8 space-y-5 py-5"
              >
                <h3 className="text-sm font-semibold">Parental controls</h3>
                <FamilyControlsUnavailable />
                <p className="text-xs text-muted-foreground">
                  For full device-level parental controls (screen time, app restrictions), use your
                  device's built-in settings.
                </p>
              </TabsContent>

              {/* KEYBOARD SHORTCUTS */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="shortcuts"
                className="overflow-y-auto px-7 pb-8 space-y-4 py-5"
              >
                <div>
                  <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Customize shortcuts for common actions. Click a combo to record a new one.
                  </p>
                </div>
                <ShortcutsEditor userKey={userKey} principalResolved={isLoaded} />
              </TabsContent>

              {/* LOCATION */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="location"
                className="overflow-y-auto px-7 pb-8 space-y-5 py-5"
              >
                <div>
                  <h3 className="text-sm font-semibold">Location</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Location-based personalization is not connected to chat or Maps yet.
                  </p>
                </div>
                <LocationControlsUnavailable />
              </TabsContent>

              {/* SAFETY & SECURITY */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="security"
                className="overflow-y-auto px-7 pb-8 space-y-6 py-5"
              >
                <Link
                  to="/trusted-contacts"
                  onClick={() => onOpenChange(false)}
                  className="block rounded-lg border p-4 text-sm hover:bg-accent"
                >
                  Manage voluntary trusted contacts
                </Link>
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
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="data"
                className="overflow-y-auto px-7 pb-8 space-y-4 py-5"
              >
                <h3 className="text-sm font-semibold">Privacy and data</h3>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => selectTab("memory")}>
                    Saved memory
                  </Button>
                  <Button variant="outline" onClick={() => selectTab("security")}>
                    Security
                  </Button>
                  <Button variant="outline" onClick={() => selectTab("storage")}>
                    Storage
                  </Button>
                </div>
                <ArchivedChatsPanel userKey={userKey} />
                <ChatTrashPanel userKey={userKey} />
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
                <AccountExportPanel
                  ownerId={isLoaded && isSignedIn ? userKey : null}
                  enabled={open && tab === "data"}
                />
                <SecurityRow
                  title="Export this device's data"
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
                      if (
                        !(await saveConversations(userKey, conversations)) ||
                        !(await saveArchivedConversations(userKey, archived))
                      )
                        throw new Error(
                          "Chat import could not be saved. Check chat sync and retry.",
                        );
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
                  title={
                    deletionScheduled
                      ? "Account deletion scheduled"
                      : deletionPending
                        ? "Account deletion pending"
                        : "Delete account"
                  }
                  body={
                    deletionScheduled
                      ? `Recovery deadline: ${deletionDeadline}. Your data remains intact during the 30-day recovery window. Billing continues unchanged; use Billing to cancel separately.`
                      : deletionPending
                        ? "Deletion is pending or its status is unverified. Check its status before assuming recovery or final cleanup. No local data is removed by a status check."
                        : "Schedule deletion after a 30-day recovery window. Your subscription and discount remain unchanged; use Billing to cancel separately. Final deletion removes your account and private data. Legally required billing, security, and backup records may be retained."
                  }
                  actionLabel={
                    deletionRecoverable
                      ? "Recover account"
                      : deletionPending
                        ? "Check deletion status"
                        : "Schedule deletion"
                  }
                  danger
                  onAction={(event) => {
                    if (
                      !open ||
                      tab !== "data" ||
                      !isLoaded ||
                      !userKey ||
                      deleteAccountBusy ||
                      currentAuthUserKeyRef.current !== userKey
                    )
                      return;
                    deleteAccountReturnRef.current = {
                      target: event.currentTarget,
                      url: window.location.href,
                      ownerId: userKey,
                    };
                    setDeleteConfirmation("");
                    setDeleteAccountOpen(true);
                  }}
                />
              </TabsContent>

              {/* STORAGE */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="storage"
                className="overflow-y-auto px-7 pb-8 space-y-4 py-5"
              >
                <StorageDashboard signedIn={loggedIn} />
                <div className="rounded-xl border border-border bg-card/60 p-5 space-y-3">
                  <h3 className="text-sm font-semibold">Local device data</h3>
                  <p className="text-xs text-muted-foreground">
                    Resets chats, drafts, handoffs, work data, image history, and account
                    preferences stored for this KovaGPT profile on this browser. Ownerless private
                    data, including transitional values from older versions, is also removed so
                    another profile cannot receive it. Other profiles' scoped data, device-wide
                    display preferences, and cloud data are preserved.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={localResetBusy || deleteAccountOpen || !isLoaded}
                    onClick={openLocalResetConfirmation}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {localResetBusy ? "Resetting…" : "Reset this profile's local data"}
                  </Button>
                </div>
              </TabsContent>

              {/* FAMILY CENTER */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="family"
                className="overflow-y-auto px-7 pb-8 space-y-5 py-5"
              >
                {!loggedIn ? <SignInGate label="Family Sharing" /> : <FamilySharingPanel />}
              </TabsContent>

              {/* REPORT ISSUE */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="report"
                className="overflow-y-auto px-7 pb-8 space-y-4 py-5"
              >
                <p className="text-xs text-muted-foreground">
                  Found a bug or something off? Send it to our team and we'll take a look.
                </p>
                <Button size="sm" asChild className="kova-settings-support-link">
                  <Link to="/help" hash="support-form" onClick={() => onOpenChange(false)}>
                    <Bug className="w-4 h-4 mr-2" />
                    Open bug report form
                  </Link>
                </Button>
              </TabsContent>

              {/* HELP CENTER */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="help"
                className="overflow-y-auto px-7 pb-8 space-y-4 py-5"
              >
                <p className="text-xs text-muted-foreground">
                  Get help, contact support, or browse common questions.
                </p>
                <Button size="sm" asChild className="kova-settings-support-link">
                  <Link to="/help" onClick={() => onOpenChange(false)}>
                    <LifeBuoy className="w-4 h-4 mr-2" />
                    Open help center
                  </Link>
                </Button>
              </TabsContent>

              {/* ABOUT */}
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="about"
                className="overflow-y-auto px-7 pb-8 space-y-3 py-5"
              >
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
              <TabsContent
                aria-labelledby={currentSectionHeadingId}
                value="logout"
                className="overflow-y-auto px-7 pb-8 space-y-4 py-5"
              >
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
      </Surface>
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        onConfirm={handleLogout}
      />
      <AlertDialog
        open={localResetConfirmOpen && localResetConfirmationRef.current !== null}
        onOpenChange={(next) => {
          if (!next) {
            localResetConfirmationRef.current = null;
            setLocalResetConfirmOpen(false);
          }
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            localResetCancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = localResetReturnRef.current;
            restoreDialogFocus(
              previous?.target,
              previous?.url,
              !previous ||
                previous.generation !== localResetScopeRef.current.generation ||
                previous.ownerId !== currentAuthUserKeyRef.current,
            );
            localResetReturnRef.current = null;
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this profile's local data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes this profile's chats, drafts, local handoffs, work data,
              image history, and account preferences from this browser. Ownerless private data from
              older versions is also removed. Other profiles' scoped data, device-wide display
              preferences, and cloud data are preserved. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={localResetCancelRef}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmLocalReset}>
              Reset local data
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        open={
          deleteAccountOpen &&
          open &&
          tab === "data" &&
          isLoaded &&
          deleteAccountReturnRef.current?.ownerId === userKey
        }
        onOpenChange={(next) => {
          if (deleteAccountBusy) return;
          setDeleteAccountOpen(next);
          if (!next) setDeleteConfirmation("");
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = deleteAccountReturnRef.current;
            restoreDialogFocus(
              previous?.target,
              previous?.url,
              !open ||
                tab !== "data" ||
                !previous ||
                previous.ownerId !== currentAuthUserKeyRef.current,
            );
            deleteAccountReturnRef.current = null;
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletionRecoverable
                ? "Recover your account?"
                : deletionPending
                  ? "Account deletion status"
                  : "Schedule account deletion?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletionRecoverable
                ? `Recover before ${deletionDeadline} to keep the same account and data. Your subscription and discount are unchanged; recovery does not cancel billing.`
                : deletionPending
                  ? "The recovery deadline may have passed or deletion status needs verification. A status check does not recover the account, start cleanup or change billing."
                  : "Your account and data stay recoverable for 30 days before final deletion. Scheduling does not cancel billing or change your discount; cancel separately in Billing if desired. Legally required billing, security, and backup records may be retained. Type DELETE to schedule."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!deletionPending && (
            <Input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder="Type DELETE"
              aria-label="Type DELETE to confirm"
              autoComplete="off"
              disabled={deleteAccountBusy}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccountBusy}>
              {deletionPending ? "Close" : "Cancel"}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={
                deletionRecoverable
                  ? handleRecoverAccount
                  : deletionPending
                    ? handleCheckDeletion
                    : handleDeleteAccount
              }
              disabled={(!deletionPending && deleteConfirmation !== "DELETE") || deleteAccountBusy}
            >
              {deleteAccountBusy
                ? "Working…"
                : deletionRecoverable
                  ? "Recover account"
                  : deletionPending
                    ? "Check deletion status"
                    : "Schedule deletion"}
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
  onAction: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4 transition-colors ${
        danger ? "border-destructive/40 bg-destructive/5" : "border-border"
      }`}
    >
      <div className="min-w-0 flex-1 basis-48">
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
    <div className="kova-settings-row flex items-start justify-between">
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
  project: string;
  work: string;
  prompt: string;
  research: string;
  artifact: string;
};

const DEFAULT_WORKSPACE_DEFAULTS: WorkspaceDefaultValues = {
  project: "Balanced",
  work: "Review before completion",
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
    ["project", "Project defaults", ["Balanced", "Concise instructions", "Detailed instructions"]],
    ["work", "Work defaults", ["Review before completion", "Approval gates", "Manual steps"]],
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
          Defaults are saved on this device and never imply an action ran.
        </p>
      </div>
      {fields.map(([key, label, options]) => (
        <label key={key} className="block text-xs text-muted-foreground">
          {label}
          <select
            value={defaults[key]}
            onChange={(event) => update(key, event.target.value)}
            className="kova-workspace-action mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground"
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
  const { user, isLoaded } = useUser();
  const timeFormat = useTimeFormatPreference(user?.id ?? null, isLoaded);
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
            {item
              ? `${item.item_type} · ${formatDisplayDateTime(item.created_at, timeFormat)}`
              : ""}
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
  const { user } = useUser();
  return <LibraryPanelForOwner key={user?.id ?? "guest"} ownerId={user?.id ?? null} />;
}
function LibraryPanelForOwner({ ownerId }: { ownerId: string | null }) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
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
      if (!active.current) return;
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
      const item = items.find((value) => value.id === id);
      if (!item || !ownerId || !active.current) return;
      await deleteLibraryItem({
        data: {
          id,
          expectedOwnerId: ownerId,
          generation: item.original_generation,
          contentGeneration: item.content_generation,
          revision: item.content_revision,
        },
      });
      if (!active.current) return;
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
// preferences and appearance. All copy is KovaGPT-branded (not copied from
// any other provider).
function SignedOutSettings({
  settings,
  setMode,
  onSignIn,
  onClose,
}: {
  settings: Settings;
  setMode: (m: ThemeMode) => void;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<"general" | "data" | "help">("general");

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
            ["help", "Help & legal", LifeBuoy],
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

      <div className="kova-settings-guest-content min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {section === "general" ? (
          <section className="space-y-4">
            <h3>General</h3>
            <div className="kova-settings-reference-group">
              <div className="kova-settings-reference-row">
                <span className="text-sm">Appearance</span>
                <div className="w-44">
                  <Select
                    value={settings.mode ?? "system"}
                    onValueChange={(v) => setMode(v as ThemeMode)}
                  >
                    <SelectTrigger
                      aria-label="Appearance"
                      className="kova-settings-reference-select"
                    >
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
              <div className="kova-settings-reference-row">
                <div className="min-w-0">
                  <div className="text-sm">Account</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sign in to use account-backed chats, memory, and paid features. Browser
                    preferences stay on this device.
                  </p>
                </div>
                <Button onClick={onSignIn} className="h-9 rounded-full px-5 text-sm">
                  Sign in
                </Button>
              </div>
            </div>
          </section>
        ) : section === "data" ? (
          <div className="space-y-5">
            <h3>Data controls</h3>
            <ArchivedChatsPanel userKey={null} />
            <ChatTrashPanel userKey={null} />
            <div className="rounded-xl border border-border/60 bg-card/40 p-4">
              <div className="text-sm font-medium">How signed-out data is stored</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Signed-out chats stay in this tab until you refresh or close it. Your appearance
                preference remains in this browser, but nothing here is synced to an account. Read
                the{" "}
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
        ) : (
          <section className="kova-settings-help-links" aria-labelledby="guest-help-title">
            <h2 id="guest-help-title" className="text-lg font-semibold">
              Help & legal
            </h2>
            <p className="text-sm text-muted-foreground">
              Get answers, review plans, or read how KovaGPT works.
            </p>
            <Link to="/help" onClick={onClose}>
              Help center <ExternalLink aria-hidden="true" />
            </Link>
            <Link to="/pricing" onClick={onClose}>
              Plans and subscriptions <ExternalLink aria-hidden="true" />
            </Link>
            <Link to="/terms" onClick={onClose}>
              Terms of Service <ExternalLink aria-hidden="true" />
            </Link>
            <Link to="/privacy" onClick={onClose}>
              Privacy Policy <ExternalLink aria-hidden="true" />
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}

function ArchivedChatsPanel({ userKey }: { userKey: string | null }) {
  type Chat = ReturnType<typeof loadArchivedConversations>[number];
  type Failure = {
    userKey: string | null;
    chat: Chat;
    action: "restore" | "archive" | "delete" | "delete-cleanup";
    message: string;
  };
  type DeleteTarget = {
    chat: Chat;
    userKey: string | null;
    epoch: number;
    trigger: HTMLElement;
    url: string;
    retentionMs: number;
    expiresAt?: number;
    transferComplete?: boolean;
  };
  const [revision, setRevision] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const contextRef = useRef({ userKey, epoch: 0, active: true });
  if (contextRef.current.userKey !== userKey)
    contextRef.current = { userKey, epoch: contextRef.current.epoch + 1, active: true };
  const busyRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteHeadingRef = useRef<HTMLHeadingElement>(null);
  const deleteReturnRef = useRef<DeleteTarget | null>(null);
  const deleteConfirmedRef = useRef(false);
  const deleteTargetRef = useRef(deleteTarget);
  deleteTargetRef.current = deleteTarget;
  const archived = loadArchivedConversations(userKey);
  const visibleFailure = failure?.userKey === userKey ? failure : null;
  const visibleDelete =
    deleteTarget?.userKey === userKey && deleteTarget.epoch === contextRef.current.epoch
      ? deleteTarget
      : null;
  useEffect(() => {
    const reset = () => {
      contextRef.current.epoch += 1;
      busyRef.current = false;
      deleteReturnRef.current = null;
      deleteConfirmedRef.current = false;
      setPending(false);
      setFailure(null);
      deleteTargetRef.current = null;
      setDeleteTarget(null);
      setRevision((value) => value + 1);
    };
    contextRef.current.active = true;
    reset();
    const cleared = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, userKey)) reset();
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
    return () => {
      contextRef.current.active = false;
      contextRef.current.epoch += 1;
      deleteReturnRef.current = null;
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, cleared);
    };
  }, [userKey]);
  const run = async (chat: Chat, action: Failure["action"], target?: DeleteTarget) => {
    const context = contextRef.current;
    if (!context.active || context.userKey !== userKey || busyRef.current) return;
    const deleting = action === "delete" || action === "delete-cleanup";
    if (deleting && (!target || deleteTargetRef.current !== target)) return;
    const epoch = context.epoch;
    const current = () =>
      contextRef.current.active &&
      contextRef.current.userKey === userKey &&
      contextRef.current.epoch === epoch;
    busyRef.current = true;
    (deleting ? deleteHeadingRef.current : headingRef.current)?.focus({
      preventScroll: true,
    });
    setPending(true);
    setFailure(null);
    let stage = action;
    try {
      if (deleting && target && !target.transferComplete) {
        const state = readChatTrash(userKey);
        const existing = state.entries.find((entry) => entry.conversation.id === chat.id);
        if (state.retentionMs !== target.retentionMs || existing?.expiresAt !== target.expiresAt) {
          const next = {
            ...target,
            retentionMs: state.retentionMs,
            expiresAt: existing?.expiresAt,
          };
          deleteTargetRef.current = next;
          setDeleteTarget(next);
          throw new Error(
            `Trash retention changed for “${chat.title}”. Review the updated consequence and confirm again.`,
          );
        }
        if (state.retentionMs !== 0 || existing) {
          const deletedAt = Date.now();
          const entry = existing ?? {
            conversation: chat,
            deletedAt,
            expiresAt: deletedAt + state.retentionMs,
          };
          // Save a recoverable copy first. Reuse any previous transfer without extending its deadline.
          if (!existing) writeChatTrash(userKey, { ...state, entries: [entry, ...state.entries] });
          if (!current()) return;
          const next = { ...target, expiresAt: entry.expiresAt, transferComplete: true };
          deleteTargetRef.current = next;
          setDeleteTarget(next);
          stage = "delete-cleanup";
        }
      }
      if (target?.transferComplete) stage = "delete-cleanup";
      if (action === "restore") {
        if (
          !(await saveConversations(
            userKey,
            mergeConversations(loadConversations(userKey), [chat]),
          ))
        )
          throw new Error(
            `Could not restore “${chat.title}”. Retry restore when storage is available.`,
          );
        if (!current()) return;
        stage = "archive";
      }
      if (
        !(await saveArchivedConversations(
          userKey,
          loadArchivedConversations(userKey).filter((item) => item.id !== chat.id),
        ))
      )
        throw new Error(
          stage === "delete-cleanup"
            ? `“${chat.title}” is in Trash, but removing it from Archived chats could not be confirmed. Retry archive cleanup; its Trash deadline is unchanged.`
            : stage === "delete"
              ? `Could not permanently delete archived chat “${chat.title}”. Retry deletion when storage is available.`
              : `“${chat.title}” was restored, but the archive update could not be confirmed. Retry the archive update.`,
        );
      if (!current()) return;
      setRevision((value) => value + 1);
      if (deleting) {
        deleteConfirmedRef.current = true;
        deleteTargetRef.current = null;
        setDeleteTarget(null);
        toast.success(stage === "delete-cleanup" ? "Chat moved to Trash" : "Archived chat deleted");
      } else {
        window.dispatchEvent(new Event("kova:conversations-imported"));
        toast.success("Chat restored");
      }
    } catch (cause) {
      if (!current()) return;
      setFailure({
        userKey,
        chat,
        action: stage,
        message:
          cause instanceof Error && cause.message.includes(chat.title)
            ? cause.message
            : stage === "delete-cleanup"
              ? `“${chat.title}” is in Trash, but removing it from Archived chats could not be confirmed. Retry archive cleanup; its Trash deadline is unchanged.`
              : stage === "archive"
                ? `“${chat.title}” was restored, but the archive update could not be confirmed. Retry the archive update.`
                : stage === "delete"
                  ? `Could not delete archived chat “${chat.title}”. Its archived copy is still available. Try again when Trash storage is available.`
                  : `Could not restore “${chat.title}”. Try again.`,
      });
    } finally {
      if (current()) {
        busyRef.current = false;
        setPending(false);
      }
    }
  };
  const reviewDelete = (chat: Chat, trigger: HTMLElement) => {
    if (!contextRef.current.active || contextRef.current.userKey !== userKey || busyRef.current)
      return;
    try {
      const state = readChatTrash(userKey);
      const existing = state.entries.find((entry) => entry.conversation.id === chat.id);
      const target = {
        chat,
        trigger,
        userKey,
        epoch: contextRef.current.epoch,
        url: window.location.href,
        retentionMs: state.retentionMs,
        expiresAt: existing?.expiresAt,
      };
      if (failure && (failure.chat.id !== chat.id || !failure.action.startsWith("delete")))
        setFailure(null);
      deleteReturnRef.current = target;
      deleteConfirmedRef.current = false;
      deleteTargetRef.current = target;
      setDeleteTarget(target);
    } catch {
      headingRef.current?.focus({ preventScroll: true });
      setFailure({
        userKey,
        chat,
        action: "delete",
        message: `Could not review deletion of “${chat.title}” because Trash storage is unavailable. Its archived copy is unchanged. Try again.`,
      });
    }
  };
  const retentionLabel = visibleDelete
    ? (TRASH_RETENTION_OPTIONS.find((option) => option.value === visibleDelete.retentionMs)
        ?.label ?? `${visibleDelete.retentionMs / 60_000} minutes`)
    : "";

  const failureNotice = visibleFailure ? (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
      <p className="text-destructive">{visibleFailure.message}</p>
      <div className="flex flex-wrap gap-2">
        {!visibleDelete && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={(event) => {
              if (visibleFailure.action.startsWith("delete"))
                reviewDelete(visibleFailure.chat, event.currentTarget);
              else void run(visibleFailure.chat, visibleFailure.action);
            }}
          >
            {visibleFailure.action.startsWith("delete")
              ? "Review delete"
              : visibleFailure.action === "archive"
                ? "Retry archive update"
                : "Retry restore"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!contextRef.current.active || contextRef.current.userKey !== userKey) return;
            (visibleDelete ? deleteHeadingRef.current : headingRef.current)?.focus({
              preventScroll: true,
            });
            setFailure(null);
          }}
        >
          Dismiss error
        </Button>
      </div>
    </div>
  ) : null;
  return (
    <section
      className="rounded-xl border border-border/70 bg-card/60 p-4"
      aria-label="Archived chats"
      aria-busy={pending}
    >
      <div className="mb-3">
        <h4 ref={headingRef} tabIndex={-1} className="text-sm font-medium">
          Archived chats
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Review or restore conversations you moved out of your sidebar.
        </p>
      </div>
      {!visibleDelete && failureNotice}
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
                disabled={pending}
                onClick={() => void run(chat, "restore")}
              >
                Restore
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 rounded-full text-muted-foreground hover:text-destructive"
                disabled={pending}
                aria-label={`Delete archived chat ${chat.title}`}
                onClick={(event) => reviewDelete(chat, event.currentTarget)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">No archived chats</p>
        )}
      </div>
      <AlertDialog
        open={Boolean(visibleDelete)}
        onOpenChange={(next) => {
          if (!next && !busyRef.current) {
            deleteTargetRef.current = null;
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (
              visibleDelete &&
              deleteTargetRef.current === visibleDelete &&
              contextRef.current.active &&
              visibleDelete.epoch === contextRef.current.epoch
            )
              cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const origin = deleteReturnRef.current;
            deleteReturnRef.current = null;
            const active = document.activeElement;
            const focusMoved =
              active !== null &&
              active !== document.body &&
              active !== origin?.trigger &&
              !(event.target instanceof HTMLElement && event.target.contains(active));
            const trigger = origin?.trigger;
            const canReturn =
              trigger?.isConnected &&
              trigger.getClientRects().length > 0 &&
              !trigger.closest('[inert], [aria-hidden="true"]') &&
              !trigger.matches(":disabled");
            restoreDialogFocus(
              !deleteConfirmedRef.current && canReturn ? trigger : headingRef.current,
              origin?.url,
              !contextRef.current.active ||
                origin?.userKey !== contextRef.current.userKey ||
                origin?.epoch !== contextRef.current.epoch ||
                focusMoved,
            );
            deleteConfirmedRef.current = false;
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle ref={deleteHeadingRef} tabIndex={-1}>
              {visibleDelete?.expiresAt !== undefined || visibleDelete?.retentionMs !== 0
                ? `Move “${visibleDelete?.chat.title}” to Trash?`
                : `Delete “${visibleDelete?.chat.title}” permanently?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {visibleDelete?.expiresAt !== undefined
                ? `The existing Trash copy keeps its original deadline: ${new Date(visibleDelete.expiresAt).toLocaleString()}. Only the archived copy will be removed; this will not extend recovery time.`
                : visibleDelete?.retentionMs === 0
                  ? `Trash retention is Instantly. This permanently removes “${visibleDelete.chat.title}” from Archived chats without a recoverable Trash copy. This cannot be undone.`
                  : `“${visibleDelete?.chat.title}” will leave Archived chats and can be restored from this browser’s Trash for ${retentionLabel}. Archive itself has no Trash expiry.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {visibleDelete && failureNotice}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef} disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !visibleDelete}
              onClick={() => {
                const target = visibleDelete;
                if (
                  !target ||
                  deleteTargetRef.current !== target ||
                  target.epoch !== contextRef.current.epoch ||
                  target.userKey !== contextRef.current.userKey
                )
                  return;
                void run(
                  target.chat,
                  target.transferComplete ? "delete-cleanup" : "delete",
                  target,
                );
              }}
            >
              {pending
                ? "Updating archived chat…"
                : visibleDelete?.transferComplete
                  ? "Retry archive cleanup"
                  : visibleFailure?.action.startsWith("delete")
                    ? "Retry delete"
                    : visibleDelete?.expiresAt !== undefined || visibleDelete?.retentionMs !== 0
                      ? "Move to Trash"
                      : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
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
  type Shortcut = import("@/lib/shortcuts").Shortcut;
  type Retry =
    | { kind: "reset" }
    | { kind: "load" }
    | { kind: "record"; id: string }
    | { kind: "save"; id: string; combo: string };
  type Action =
    { kind: "reset" } | { kind: "save"; id: string; combo?: string; event?: KeyboardEvent };
  const principal = principalResolved ? browserStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const activeRef = useRef(true);
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const [pending, setPending] = useState(false);
  const [loadRetry, setLoadRetry] = useState(0);
  const [failure, setFailure] = useState<{
    principal: string;
    message: string;
    retry: Retry;
  } | null>(null);
  const [list, setList] = useState<Shortcut[]>([]);
  const [listPrincipal, setListPrincipal] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const ready = principal !== null && listPrincipal === principal;
  const visibleList = useMemo(() => (ready ? list : []), [list, ready]);
  const visibleFailure = failure?.principal === principal ? failure : null;

  useEffect(() => {
    let cancelled = false;
    activeRef.current = true;
    operationRef.current += 1;
    busyRef.current = false;
    setPending(false);
    setFailure(null);
    setRecordingId(null);
    (async () => {
      try {
        const mod = await import("@/lib/shortcuts");
        if (!cancelled && principalRef.current === principal) {
          setList(principal ? mod.loadShortcuts(userKey) : []);
          setListPrincipal(principal);
        }
      } catch {
        if (!cancelled && principal && principalRef.current === principal)
          setFailure({
            principal,
            message: "Keyboard shortcuts could not be loaded. Try loading them again.",
            retry: { kind: "load" },
          });
      }
    })();
    return () => {
      cancelled = true;
      activeRef.current = false;
      operationRef.current += 1;
    };
  }, [principal, userKey, loadRetry]);

  useEffect(() => {
    if (!principalResolved || !principal) return;
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      operationRef.current += 1;
      busyRef.current = false;
      setPending(false);
      setFailure(null);
      setList([]);
      setListPrincipal(null);
      setRecordingId(null);
      setLoadRetry((value) => value + 1);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
  }, [principal, principalResolved, userKey]);

  const perform = useCallback(
    async (action: Action) => {
      if (
        !ready ||
        !principal ||
        !activeRef.current ||
        principalRef.current !== principal ||
        busyRef.current
      )
        return;
      const operation = ++operationRef.current;
      const current = () =>
        activeRef.current &&
        principalRef.current === principal &&
        operationRef.current === operation;
      busyRef.current = true;
      setPending(true);
      setFailure(null);
      setRecordingId(null);
      // This retained status target survives a failed-action button disappearing.
      headingRef.current?.focus({ preventScroll: true });
      const shortcut =
        action.kind === "save" ? visibleList.find((item) => item.id === action.id) : null;
      let retry: Retry =
        action.kind === "reset" ? { kind: "reset" } : { kind: "record", id: action.id };
      try {
        const mod = await import("@/lib/shortcuts");
        if (!current()) return;
        if (action.kind === "reset") {
          if (!mod.resetShortcuts(userKey))
            throw new Error(
              "Keyboard shortcuts could not be reset in this browser. Your current shortcuts are still shown.",
            );
          setList(mod.DEFAULT_SHORTCUTS);
          toast.success("Shortcuts reset");
        } else {
          if (!shortcut) return;
          const combo =
            action.combo ??
            (action.event ? mod.shortcutComboFromKeyboardEvent(action.event) : null);
          if (!combo)
            throw new Error(
              `That key cannot be used for “${shortcut.label}”. Record another shortcut.`,
            );
          const conflict = visibleList.find(
            (item) => item.id !== action.id && item.combo === combo,
          );
          if (conflict)
            throw new Error(
              `“${shortcut.label}” cannot use ${combo}; it is already assigned to “${conflict.label}”. Record another shortcut.`,
            );
          retry = { kind: "save", id: action.id, combo };
          const next = visibleList.map((item) =>
            item.id === action.id ? { ...item, combo } : item,
          );
          if (!mod.saveShortcuts(userKey, next))
            throw new Error(
              `The “${shortcut.label}” shortcut could not be saved in this browser. Your previous shortcut is still shown.`,
            );
          setList(next);
        }
      } catch (cause) {
        if (current())
          setFailure({
            principal,
            retry,
            message:
              cause instanceof Error &&
              (cause.message.includes("Keyboard shortcuts") ||
                cause.message.includes(shortcut?.label ?? "\0"))
                ? cause.message
                : `Could not ${action.kind === "reset" ? "reset keyboard shortcuts" : `save the “${shortcut?.label ?? "selected"}” shortcut`}. Try again.`,
          });
      } finally {
        if (current()) {
          busyRef.current = false;
          setPending(false);
        }
      }
    },
    [principal, ready, userKey, visibleList],
  );

  useEffect(() => {
    if (!recordingId) return;
    const onKey = (event: KeyboardEvent) => {
      if (!ready || busyRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (["Shift", "Control", "Meta", "Alt"].includes(event.key)) return;
      void perform({ kind: "save", id: recordingId, event });
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, {
        capture: true,
      } as unknown as EventListenerOptions);
  }, [recordingId, ready, perform]);

  const record = (id: string) => {
    if (!ready || pending || !activeRef.current || principalRef.current !== principal) return;
    headingRef.current?.focus({ preventScroll: true });
    setFailure(null);
    setRecordingId(id);
  };
  return (
    <div className="space-y-2" aria-busy={!ready || pending}>
      <p ref={headingRef} tabIndex={-1} className="text-sm text-muted-foreground">
        {pending ? "Saving keyboard shortcuts…" : "Keyboard shortcut preferences"}
      </p>
      {visibleFailure && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
          <p className="text-destructive">{visibleFailure.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (!activeRef.current || principalRef.current !== principal) return;
                const retry = visibleFailure.retry;
                if (retry.kind === "load") {
                  headingRef.current?.focus({ preventScroll: true });
                  setLoadRetry((value) => value + 1);
                } else if (retry.kind === "record") record(retry.id);
                else void perform(retry);
              }}
            >
              {visibleFailure.retry.kind === "reset"
                ? "Retry reset"
                : visibleFailure.retry.kind === "save"
                  ? "Retry save"
                  : visibleFailure.retry.kind === "load"
                    ? "Retry loading shortcuts"
                    : "Record again"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (!activeRef.current || principalRef.current !== principal) return;
                headingRef.current?.focus({ preventScroll: true });
                setFailure(null);
              }}
            >
              Dismiss error
            </Button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border divide-y divide-border">
        {ready ? (
          visibleList.map((shortcut) => (
            <ShortcutRow
              key={shortcut.id}
              id={shortcut.id}
              label={shortcut.label}
              description={shortcut.description}
              combo={shortcut.combo}
              recording={recordingId === shortcut.id}
              onRecord={() => record(shortcut.id)}
              onCancel={() => setRecordingId(null)}
            />
          ))
        ) : (
          <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
            Loading shortcuts…
          </p>
        )}
      </div>
      <div>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={!ready || pending}
          onClick={() => void perform({ kind: "reset" })}
        >
          Reset to defaults
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Shortcuts stay in this browser when storage is available. "Mod" is ⌘ on macOS, Ctrl
        elsewhere.
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
        type="button"
        aria-label={`${recording ? "Stop recording" : "Change"} shortcut for ${label}`}
        aria-pressed={recording}
        onClick={recording ? onCancel : onRecord}
        className={`min-h-11 text-xs px-3 py-1.5 rounded-md border font-mono min-w-[6rem] text-center transition ${
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
