import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { approvedMcpServers } from "@/integrations/approved-mcp-servers.server.mjs";
import { configuredAdministratorIds } from "@/lib/administrator.server";
import { readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

const Details = z.object({
  kind: z.enum(["bundle", "mcp"]),
  source: z.string().trim().max(1500),
  name: z.string().trim().max(80),
  description: z.string().trim().max(320),
  documentation: z.string().trim().max(1500),
  category: z.enum([
    "Workflows",
    "Developer tools",
    "Productivity",
    "Files and notes",
    "Communication",
  ]),
  dataHandling: z.string().trim().max(3600),
  contact: z.string().trim().max(254),
  attested: z.boolean(),
});
export type ConnectorSubmissionDetails = z.infer<typeof Details>;
type SubmissionRow = {
  id: string;
  owner_id: string;
  status: "draft" | "submitted" | "approved" | "changes_requested";
  revision: number;
  details: ConnectorSubmissionDetails & { reviewedSource?: string };
  review_note: string | null;
  updated_at: string;
};
export type ConnectorSubmission = Omit<SubmissionRow, "owner_id">;
const fields = "id,status,revision,details,review_note,updated_at";
const table = () =>
  (
    supabaseAdmin as unknown as SupabaseClient<{
      public: {
        Tables: {
          connector_directory_submissions: {
            Row: SubmissionRow;
            Insert: Pick<SubmissionRow, "owner_id" | "id" | "details">;
            Update: Partial<SubmissionRow>;
            Relationships: [];
          };
        };
        Views: Record<string, never>;
        Functions: Record<string, never>;
      };
    }>
  ).from("connector_directory_submissions");

function httpsSite(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/u.test(url.hostname) ||
    /\.(?:internal|local|localhost|test|invalid)$/u.test(url.hostname)
  )
    throw new Error("Enter a public HTTPS URL.");
  return url;
}

async function validateSource(kind: ConnectorSubmissionDetails["kind"], source: string) {
  if (kind === "mcp") {
    const url = httpsSite(source);
    if (url.search || url.hash)
      throw new Error("Remove query parameters and fragments from the MCP URL.");
    const match = [...approvedMcpServers().values()].find((server) => server.url === url.href);
    return match
      ? { label: "Approved read tool found", reference: match.fingerprint }
      : { label: "HTTPS URL saved for manual server review", reference: null };
  }
  const repo = source.replace(/^https:\/\/github\.com\//iu, "").replace(/\/$/u, "");
  if (
    !/^[A-Z0-9][A-Z0-9-]{0,38}\/[A-Z0-9_.-]{1,100}$/iu.test(repo) ||
    repo.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Enter a public GitHub repository as owner/repository.");
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/kova-plugin.json`, {
    redirect: "error",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("KovaGPT could not read kova-plugin.json from the public repository.");
  }
  const file = await readProviderJsonObject(response, 32_000);
  if (
    file.type !== "file" ||
    file.encoding !== "base64" ||
    typeof file.content !== "string" ||
    typeof file.sha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(file.sha)
  )
    throw new Error("The repository must contain a readable kova-plugin.json file.");
  const manifest = z
    .object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().min(1).max(320),
    })
    .safeParse(JSON.parse(Buffer.from(file.content, "base64").toString("utf8")));
  if (!manifest.success) throw new Error("The manifest needs a name and description.");
  return { label: "Manifest verified", reference: file.sha };
}

async function checkLimit(owner: string) {
  const result = await consumeApplicationRateLimit({
    identity: `user:${owner}`,
    action: "connector_directory",
    limit: 30,
    windowSeconds: 60,
  });
  if (!result.allowed) throw new Error("Too many directory requests. Try again shortly.");
}

export const checkConnectorSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(Details.pick({ kind: true, source: true }))
  .handler(async ({ context, data }) => {
    await checkLimit(context.userId);
    return validateSource(data.kind, data.source);
  });

export const listConnectorSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const owner = context.userId;
    const own = table()
      .select(fields)
      .eq("owner_id", owner)
      .order("updated_at", { ascending: false })
      .limit(50);
    const reviewer = configuredAdministratorIds().has(owner);
    const queue = reviewer
      ? table()
          .select(fields)
          .eq("status", "submitted")
          .order("updated_at", { ascending: true })
          .limit(25)
      : Promise.resolve({ data: [], error: null });
    const [mine, reviews] = await Promise.all([own, queue]);
    if (mine.error || reviews.error) throw new Error("Submissions could not be loaded.");
    return { own: mine.data ?? [], queue: reviews.data ?? [], reviewer };
  });

export const saveConnectorSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      revision: z.number().int().min(-1).max(2_000_000),
      details: Details,
    }),
  )
  .handler(async ({ context, data }) => {
    const owner = context.userId;
    await checkLimit(owner);
    const existing = await table()
      .select(fields)
      .eq("owner_id", owner)
      .eq("id", data.id)
      .maybeSingle();
    if (existing.error) throw new Error("The draft could not be loaded.");
    if (existing.data) {
      const { data: row, error } = await table()
        .update({
          details: data.details,
          revision: data.revision + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("owner_id", owner)
        .eq("id", data.id)
        .eq("revision", data.revision)
        .in("status", ["draft", "changes_requested"])
        .select(fields)
        .maybeSingle();
      if (error || !row)
        throw new Error("This draft changed. Reopen it to load the latest version.");
      return row;
    }
    if (data.revision !== -1) throw new Error("This draft is unavailable.");
    const { data: row, error } = await table()
      .insert({
        id: data.id,
        owner_id: owner,
        details: data.details,
      })
      .select(fields)
      .single();
    if (error || !row)
      throw new Error("The draft could not be saved. Reopen Submissions to check.");
    return row;
  });

export const submitConnectorForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), revision: z.number().int().min(0) }))
  .handler(async ({ context, data }) => {
    await checkLimit(context.userId);
    const { data: row, error } = await table()
      .select(fields)
      .eq("owner_id", context.userId)
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) throw new Error("The draft could not be found.");
    if (row.status === "submitted") return row;
    if (row.revision !== data.revision || !["draft", "changes_requested"].includes(row.status))
      throw new Error("This draft changed. Reopen it to load the latest version.");
    const details = Details.parse(row.details);
    if (
      !details.name ||
      !details.description ||
      !details.dataHandling ||
      !z.string().email().safeParse(details.contact).success ||
      !details.attested
    ) {
      throw new Error("Complete content, data handling, contact and compliance before submitting.");
    }
    if (details.documentation) httpsSite(details.documentation);
    const source = await validateSource(details.kind, details.source);
    const { data: result, error: updateError } = await table()
      .update({
        status: "submitted",
        details: { ...details, ...(source.reference ? { reviewedSource: source.reference } : {}) },
        review_note: null,
        revision: row.revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", context.userId)
      .eq("id", row.id)
      .eq("revision", row.revision)
      .in("status", ["draft", "changes_requested"])
      .select(fields)
      .maybeSingle();
    if (updateError || !result)
      throw new Error("Submission status changed. Check Submissions before retrying.");
    return result;
  });

export const reviewConnectorSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      revision: z.number().int().min(0),
      decision: z.enum(["approved", "changes_requested"]),
      note: z.string().trim().max(1000),
    }),
  )
  .handler(async ({ context, data }) => {
    if (!configuredAdministratorIds().has(context.userId))
      throw new Error("Directory reviewer access is required.");
    await checkLimit(context.userId);
    const { data: row, error } = await table()
      .select(fields)
      .eq("id", data.id)
      .eq("status", "submitted")
      .maybeSingle();
    if (error || !row || row.revision !== data.revision)
      throw new Error("This submission changed.");
    if (data.decision === "approved") {
      const source = await validateSource(row.details.kind, row.details.source);
      if (
        !source.reference ||
        (row.details.kind === "bundle" && source.reference !== row.details.reviewedSource)
      )
        throw new Error(
          "The reviewed source changed or has not been approved. Request changes before publishing.",
        );
    } else if (!data.note) throw new Error("Explain what needs to change.");
    const { data: updated, error: updateError } = await table()
      .update({
        status: data.decision,
        review_note: data.note || null,
        revision: row.revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "submitted")
      .eq("revision", row.revision)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) throw new Error("This review could not be recorded.");
    return { saved: true };
  });

export const listPublishedConnectorSubmissions = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data, error } = await table()
      .select("id,details")
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(25);
    if (error) throw new Error("Published submissions could not be loaded.");
    return (data ?? []).map(({ id, details }) => ({
      id,
      name: details.name,
      description: details.description,
      category: details.category,
      documentation: details.documentation,
      kind: details.kind,
      repository:
        details.kind === "bundle"
          ? `https://github.com/${details.source.replace(/^https:\/\/github\.com\//iu, "")}`
          : null,
    }));
  },
);
