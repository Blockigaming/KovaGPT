export type ShareMode = "snapshot" | "live";
export type ShareStatus = "private" | "active" | "revoked" | "expired";
export type ProjectRole = "owner" | "editor" | "viewer";
export type SettingsSection =
  | "account"
  | "personalization"
  | "appearance"
  | "memory"
  | "data_controls"
  | "connected_apps"
  | "notifications"
  | "usage"
  | "subscription"
  | "security"
  | "about";
export type PlanState =
  | "free"
  | "active_paid"
  | "trialing"
  | "past_due"
  | "canceled_active"
  | "expired"
  | "incomplete"
  | "payment_failed";
export type AuditEventType =
  | "sign_in"
  | "password_change"
  | "mfa_change"
  | "connector_connect"
  | "connector_disconnect"
  | "connector_write"
  | "share_create"
  | "share_revoke"
  | "project_member_change"
  | "scheduled_task_change"
  | "subscription_change"
  | "account_export"
  | "account_delete_request";

export type ChatShare = {
  id: string;
  ownerId: string;
  chatId: string;
  mode: ShareMode;
  status: ShareStatus;
  tokenHash: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  snapshotVersion?: number;
};
export type ProjectMember = {
  projectId: string;
  userId: string;
  role: ProjectRole;
  invitedEmail?: string;
  invitationStatus?: "pending" | "accepted" | "declined" | "revoked";
};
export type EntitlementKey =
  | "messages"
  | "deepResearch"
  | "images"
  | "uploads"
  | "fileSizeMb"
  | "projects"
  | "projectFiles"
  | "scheduledTasks"
  | "connectorActions"
  | "analysisJobs"
  | "collaborators";
export type AuditEntry = {
  ownerId: string;
  type: AuditEventType;
  description: string;
  timestamp: string;
  actorId?: string;
  targetId?: string;
  result: "success" | "failure";
  metadata?: Record<string, string | number | boolean>;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  "account",
  "personalization",
  "appearance",
  "memory",
  "data_controls",
  "connected_apps",
  "notifications",
  "usage",
  "subscription",
  "security",
  "about",
];

export const PLAN_LIMITS: Record<"free" | "plus" | "pro", Record<EntitlementKey, number>> = {
  free: {
    messages: 25,
    deepResearch: 0,
    images: 0,
    uploads: 5,
    fileSizeMb: 10,
    projects: 2,
    projectFiles: 10,
    scheduledTasks: 0,
    connectorActions: 0,
    analysisJobs: 1,
    collaborators: 0,
  },
  plus: {
    messages: 300,
    deepResearch: 10,
    images: 50,
    uploads: 50,
    fileSizeMb: 50,
    projects: 20,
    projectFiles: 100,
    scheduledTasks: 5,
    connectorActions: 100,
    analysisJobs: 20,
    collaborators: 3,
  },
  pro: {
    messages: 1000,
    deepResearch: 50,
    images: 200,
    uploads: 200,
    fileSizeMb: 200,
    projects: 100,
    projectFiles: 1000,
    scheduledTasks: 20,
    connectorActions: 500,
    analysisJobs: 100,
    collaborators: 25,
  },
};

export function projectRoleAllows(
  role: ProjectRole,
  action: "read" | "edit" | "manage_members" | "delete_project",
) {
  if (role === "owner") return true;
  if (role === "editor") return action === "read" || action === "edit";
  return action === "read";
}

export function preventFinalOwnerRemoval(members: ProjectMember[], targetUserId: string) {
  const owners = members.filter(
    (member) => member.role === "owner" && member.invitationStatus !== "revoked",
  );
  return !(owners.length === 1 && owners[0]?.userId === targetUserId);
}

export function createShareSnapshot(input: {
  ownerId: string;
  chatId: string;
  token: string;
  expiresAt?: string;
}): ChatShare {
  return {
    id: `share-${crypto.randomUUID()}`,
    ownerId: input.ownerId,
    chatId: input.chatId,
    mode: "snapshot",
    status: "active",
    tokenHash: hashToken(input.token),
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    snapshotVersion: 1,
  };
}

export function canAccessShare(share: ChatShare, token: string) {
  if (share.status !== "active") return false;
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) return false;
  return share.tokenHash === hashToken(token);
}

export function hashToken(token: string) {
  return Array.from(new Uint8Array(new TextEncoder().encode(token)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 128);
}

export function classifyPlanState(input: {
  status?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}): PlanState {
  if (!input.status) return "free";
  if (input.status === "trialing") return "trialing";
  if (input.status === "past_due") return "past_due";
  if (input.status === "incomplete") return "incomplete";
  if (input.status === "active" && input.cancelAtPeriodEnd) return "canceled_active";
  if (input.status === "active") return "active_paid";
  if (
    input.status === "canceled" &&
    input.currentPeriodEnd &&
    new Date(input.currentPeriodEnd) > new Date()
  )
    return "canceled_active";
  if (input.status === "unpaid") return "payment_failed";
  return "expired";
}

export function enforceEntitlement(
  plan: "free" | "plus" | "pro",
  key: EntitlementKey,
  used: number,
) {
  const limit = PLAN_LIMITS[plan][key];
  return used < limit
    ? { ok: true as const, remaining: limit - used }
    : { ok: false as const, limit, message: `${key} limit reached for ${plan}.` };
}

export function sanitizeAudit(entry: AuditEntry): AuditEntry {
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(entry.metadata ?? {}))
    if (!/token|secret|password|credential|authorization|body|content/i.test(key))
      metadata[key] = value;
  return { ...entry, description: entry.description.slice(0, 300), metadata };
}
