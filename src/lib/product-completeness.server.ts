export type OnboardingStepId =
  | "welcome"
  | "appearance"
  | "response_preferences"
  | "projects"
  | "library_files"
  | "search_research"
  | "temporary_chat"
  | "connected_apps"
  | "scheduled_tasks"
  | "complete";

export type OnboardingProgress = {
  userId: string;
  eligible: boolean;
  completed: boolean;
  skipped: boolean;
  currentStep: OnboardingStepId;
  completedSteps: OnboardingStepId[];
  updatedAt: string;
};

export const ONBOARDING_STEPS: Array<{ id: OnboardingStepId; title: string; action?: string }> = [
  { id: "welcome", title: "Welcome to KovaGPT" },
  { id: "appearance", title: "Choose appearance", action: "open-settings:appearance" },
  {
    id: "response_preferences",
    title: "Set response preferences",
    action: "open-settings:personalization",
  },
  { id: "projects", title: "Organize work with Projects", action: "/projects" },
  { id: "library_files", title: "Reuse files from Library", action: "/library" },
  { id: "search_research", title: "Search and Deep Research", action: "new-chat:deep-research" },
  { id: "temporary_chat", title: "Use Temporary Chat", action: "new-chat:temporary" },
  { id: "connected_apps", title: "Connect apps when needed", action: "/apps" },
  { id: "scheduled_tasks", title: "Review Scheduled Tasks status", action: "/scheduled-tasks" },
  { id: "complete", title: "You are ready" },
];

export function shouldShowOnboarding(
  progress: OnboardingProgress | null,
  accountCreatedAt: string,
  now = new Date(),
) {
  if (progress?.completed || progress?.skipped) return false;
  const ageDays = (now.getTime() - new Date(accountCreatedAt).getTime()) / 86_400_000;
  return ageDays <= 14;
}

export function advanceOnboarding(
  progress: OnboardingProgress,
  nextStep: OnboardingStepId,
): OnboardingProgress {
  const completedSteps = Array.from(new Set([...progress.completedSteps, progress.currentStep]));
  return {
    ...progress,
    currentStep: nextStep,
    completed: nextStep === "complete",
    completedSteps,
    updatedAt: new Date().toISOString(),
  };
}

export type EmptyStateRoute =
  | "chat"
  | "projects"
  | "project_detail"
  | "library"
  | "images"
  | "apps"
  | "scheduled_tasks"
  | "canvas"
  | "research_history"
  | "notifications"
  | "settings"
  | "shared_chats"
  | "audit_history";

export type GuidedEmptyState = {
  route: EmptyStateRoute;
  title: string;
  description: string;
  primaryAction: { label: string; href?: string; action?: string };
  secondaryAction?: { label: string; href?: string; action?: string };
};

export const EMPTY_STATES: Record<EmptyStateRoute, GuidedEmptyState> = {
  chat: {
    route: "chat",
    title: "Start a conversation",
    description: "Ask KovaGPT anything or choose a focused mode.",
    primaryAction: { label: "New chat", href: "/" },
  },
  projects: {
    route: "projects",
    title: "No projects yet",
    description: "Create a workspace for chats, files, and instructions.",
    primaryAction: { label: "Create project", action: "create-project" },
  },
  project_detail: {
    route: "project_detail",
    title: "This project is empty",
    description: "Add a chat, file, or instruction to build shared context.",
    primaryAction: { label: "New project chat", action: "new-project-chat" },
  },
  library: {
    route: "library",
    title: "Your Library is empty",
    description: "Upload files, save answers, or generate images to collect reusable assets.",
    primaryAction: { label: "Upload file", action: "upload-file" },
    secondaryAction: { label: "Generate image", href: "/images" },
  },
  images: {
    route: "images",
    title: "No images yet",
    description: "Generate an image and save it to your Library.",
    primaryAction: { label: "Generate image", href: "/images" },
  },
  apps: {
    route: "apps",
    title: "No connected apps",
    description: "Connect Google when you want Gmail, Calendar, or Drive context.",
    primaryAction: { label: "Connect Google", action: "connect-google" },
  },
  scheduled_tasks: {
    route: "scheduled_tasks",
    title: "Scheduled execution unavailable",
    description:
      "This deployment has no background runner. Existing tasks can be reviewed, paused, or deleted.",
    primaryAction: { label: "Review existing tasks", href: "/scheduled-tasks" },
  },
  canvas: {
    route: "canvas",
    title: "No Canvas documents",
    description: "Create a long-form document from chat or start a draft.",
    primaryAction: { label: "Start writing", href: "/write" },
  },
  research_history: {
    route: "research_history",
    title: "No research reports",
    description: "Start Deep Research to build a cited report.",
    primaryAction: { label: "Start Deep Research", action: "new-chat:deep-research" },
  },
  notifications: {
    route: "notifications",
    title: "No notifications",
    description: "Task results, project invites, and security alerts appear here.",
    primaryAction: { label: "Notification settings", action: "open-settings:notifications" },
  },
  settings: {
    route: "settings",
    title: "Choose a setting",
    description:
      "Use the navigation to update account, memory, data, security, and billing preferences.",
    primaryAction: { label: "Account", action: "open-settings:account" },
  },
  shared_chats: {
    route: "shared_chats",
    title: "No shared chats",
    description: "Shared read-only snapshots appear here after you create a link.",
    primaryAction: { label: "Open chats", href: "/" },
  },
  audit_history: {
    route: "audit_history",
    title: "No audit events",
    description: "Security, connector, billing, and sharing events appear here.",
    primaryAction: { label: "Back to settings", action: "open-settings:security" },
  },
};

export type SearchResultType =
  | "chat"
  | "project"
  | "project_file"
  | "library"
  | "image"
  | "artifact"
  | "research"
  | "scheduled_task"
  | "shared_chat";
export type GlobalSearchResult = {
  id: string;
  ownerId: string;
  type: SearchResultType;
  title: string;
  snippet: string;
  href: string;
  projectId?: string;
  authorizedProjectIds?: string[];
  updatedAt?: string;
};

export function filterAuthorizedSearchResults(
  results: GlobalSearchResult[],
  userId: string,
  projectIds: string[],
) {
  return results.filter((result) => {
    if (result.ownerId !== userId) return false;
    if (result.projectId && !projectIds.includes(result.projectId)) return false;
    return true;
  });
}

export function groupSearchResults(results: GlobalSearchResult[]) {
  return results.reduce<Record<SearchResultType, GlobalSearchResult[]>>(
    (groups, result) => {
      groups[result.type] = [...(groups[result.type] ?? []), result];
      return groups;
    },
    {} as Record<SearchResultType, GlobalSearchResult[]>,
  );
}

export type CommandId =
  | "new_chat"
  | "global_search"
  | "new_project"
  | "open_library"
  | "generate_image"
  | "deep_research"
  | "temporary_chat"
  | "create_task"
  | "open_apps"
  | "open_settings"
  | "toggle_theme"
  | "open_help";
export type CommandDefinition = {
  id: CommandId;
  label: string;
  href?: string;
  action?: string;
  disabledReason?: string;
  planGate?: "plus" | "pro";
};
export const COMMANDS: CommandDefinition[] = [
  { id: "new_chat", label: "New chat", href: "/" },
  { id: "global_search", label: "Search KovaGPT", action: "open-global-search" },
  { id: "new_project", label: "New project", href: "/projects" },
  { id: "open_library", label: "Open Library", href: "/library" },
  { id: "generate_image", label: "Generate image", href: "/images" },
  {
    id: "deep_research",
    label: "Start Deep Research",
    action: "new-chat:deep-research",
    planGate: "plus",
  },
  { id: "temporary_chat", label: "Temporary Chat", action: "new-chat:temporary" },
  {
    id: "create_task",
    label: "Scheduled Tasks status",
    href: "/scheduled-tasks",
    planGate: "plus",
  },
  { id: "open_apps", label: "Open Apps", href: "/apps" },
  { id: "open_settings", label: "Open Settings", action: "open-settings" },
  { id: "toggle_theme", label: "Toggle appearance", action: "toggle-theme" },
  { id: "open_help", label: "Open Help", href: "/help" },
];

export type NotificationType =
  | "task_result"
  | "task_failure"
  | "connector_reauth"
  | "shared_chat"
  | "project_invitation"
  | "project_role_change"
  | "billing_issue"
  | "usage_threshold"
  | "deep_research_complete"
  | "file_processing"
  | "security_alert";
export type AppNotification = {
  id: string;
  ownerId: string;
  type: NotificationType;
  title: string;
  preview: string;
  createdAt: string;
  readAt?: string | null;
  actionUrl?: string;
  sourceEntity?: string;
  deliveryState: "pending" | "delivered" | "failed" | "expired";
  expiresAt?: string;
};
export function safeNotificationPreview(text: string) {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/token|secret|credential|authorization|gmail|drive/gi, "[redacted]")
    .slice(0, 220);
}

export type SupportCategory =
  | "account_access"
  | "billing"
  | "technical_issue"
  | "data_privacy"
  | "safety_concern"
  | "feature_request"
  | "connector_issue"
  | "scheduled_task_issue";
export type SupportTicket = {
  id: string;
  ownerId?: string;
  category: SupportCategory;
  subject: string;
  description: string;
  includeDiagnostics: boolean;
  diagnostics?: Record<string, string>;
  correlationId: string;
  status: "draft" | "submitted" | "failed" | "retry";
  createdAt: string;
};
export type FeedbackReason =
  | "incorrect"
  | "harmful"
  | "citation_issue"
  | "tool_failure"
  | "ui_issue"
  | "feature_request"
  | "other";
export type FeedbackSubmission = {
  id: string;
  ownerId?: string;
  messageId?: string;
  rating?: "up" | "down";
  reason?: FeedbackReason;
  comment?: string;
  attachContext: boolean;
  status: "submitted" | "failed";
};
export function sanitizeSupportText(text: string) {
  return text
    .replace(/(api[_-]?key|oauth|session|token|secret|password)[^\s]*/gi, "[redacted]")
    .slice(0, 5000);
}

export type AdminPermission =
  | "user_lookup"
  | "support_tickets"
  | "abuse_reports"
  | "failed_tasks"
  | "connector_health"
  | "system_notices"
  | "feature_flags"
  | "ban_users"
  | "audit_search";
export type AdminSession = { userId: string; roles: string[]; permissions: AdminPermission[] };
export function requireAdminPermission(session: AdminSession | null, permission: AdminPermission) {
  return !!session?.roles.includes("admin") && session.permissions.includes(permission);
}

export type AccountStatus =
  | "active"
  | "email_verification_required"
  | "restricted"
  | "temporarily_suspended"
  | "permanently_banned"
  | "deletion_pending"
  | "deleted";
export function accountStatusAllowsWrite(status: AccountStatus) {
  return status === "active";
}

export type SafetyReportReason =
  | "shared_chat"
  | "shared_artifact"
  | "project_invitation"
  | "generated_content"
  | "harassment_spam"
  | "impersonation"
  | "privacy_issue"
  | "unsafe_content"
  | "other";
export type SafetyReport = {
  id: string;
  targetId: string;
  reporterId: string;
  reason: SafetyReportReason;
  explanation?: string;
  status: "submitted" | "triaged" | "actioned" | "dismissed";
  createdAt: string;
  duplicateKey: string;
};

export type UpgradeState =
  | "feature_unavailable"
  | "limit_reached"
  | "trial_available"
  | "upgrade_successful"
  | "payment_pending"
  | "payment_failed"
  | "canceled_active"
  | "past_due";
export function upgradeMessage(state: UpgradeState, plan: string, limit?: number) {
  const limitText = typeof limit === "number" ? ` Current limit: ${limit}.` : "";
  return `${state.replace(/_/g, " ")} on ${plan}.${limitText} Your work is preserved.`;
}

export type RouteErrorKind =
  | "loader"
  | "auth"
  | "authorization"
  | "missing_entity"
  | "network"
  | "database"
  | "provider"
  | "validation"
  | "rate_limit"
  | "timeout";
export function routeErrorMessage(kind: RouteErrorKind, correlationId: string) {
  const base =
    kind === "authorization"
      ? "You do not have access to this resource."
      : kind === "missing_entity"
        ? "This item could not be found."
        : kind === "rate_limit"
          ? "That limit was reached. Try again later."
          : "Something went wrong. You can retry safely.";
  return {
    message: base,
    correlationId,
    retryable: ["network", "database", "provider", "timeout", "loader"].includes(kind),
  };
}

export type NetworkState = "online" | "offline" | "reconnecting" | "slow" | "timed_out";
export type OptimisticState<T> = {
  previous: T;
  optimistic: T;
  status: "pending" | "confirmed" | "rolled_back";
  error?: string;
};
export function rollbackOptimistic<T>(
  state: OptimisticState<T>,
  error: string,
): OptimisticState<T> {
  return { ...state, optimistic: state.previous, status: "rolled_back", error };
}

export const PERFORMANCE_CONTRACTS = [
  "lazy-load-heavy-routes",
  "route-level-suspense",
  "image-lazy-loading",
  "paginated-large-lists",
  "request-cancellation",
  "query-deduplication",
  "no-eager-provider-or-connector-init",
];

export type FeatureClassification =
  | "implemented_source"
  | "partial_source"
  | "deferred_product"
  | "blocked_external_access"
  | "blocked_runtime_dependency"
  | "not_implemented";
export const FEATURE_RECONCILIATION: Record<string, FeatureClassification> = {
  voice: "deferred_product",
  recovery_deployment: "blocked_external_access",
  build_browser_verification: "blocked_runtime_dependency",
  ai_core: "implemented_source",
  projects_library: "implemented_source",
  multimodal_canvas: "implemented_source",
  connectors_tasks_settings_billing: "implemented_source",
  onboarding_support_admin_reliability: "implemented_source",
};

export const TRUST_POLICY_ROUTES = [
  { path: "/terms", title: "Terms", updated: "2026-07-22" },
  { path: "/privacy", title: "Privacy", updated: "2026-07-22" },
  { path: "/refund", title: "Refund policy", updated: "2026-07-22" },
  { path: "/safety", title: "AI safety", updated: "2026-07-22" },
  { path: "/acceptable-use", title: "Acceptable use", updated: "2026-07-22" },
  { path: "/help", title: "Help and support", updated: "2026-07-22" },
];

export const RELIABILITY_COPY = {
  offline: "You are offline. Drafts stay on this device until you reconnect.",
  retry: "Retry this safe action without duplicating writes.",
  error: "No raw provider stack traces are shown. Use the correlation ID for support.",
};
