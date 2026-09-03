import { replaceControlCharacters } from "@/lib/sanitize-text";
import {
  chatCompletions,
  chatModel,
  utilityModel,
  providerErrorFromResponse,
  type JsonObject,
} from "@/lib/ai/provider.server";
import { createToolActivityEvent, type ToolActivityEvent } from "@/lib/ai/activity.server";
import { searchWeb, type WebSource } from "@/lib/ai/search.server";
import { modelForRole } from "@/lib/ai/model-router.server";
import { UTILITY_MAX_OUTPUT_TOKENS } from "@/lib/ai/model-config.mjs";

export type ResearchStageStatus =
  "created" | "pending" | "running" | "complete" | "failed" | "canceled";

export type ResearchStage = {
  id:
    | "created"
    | "intake"
    | "planning"
    | "searching"
    | "reading"
    | "comparing"
    | "analyzing"
    | "writing_report"
    | "complete"
    | "failed"
    | "canceled";
  label: string;
  status: ResearchStageStatus;
  detail?: string;
};

export type ResearchSourceState = "discovered" | "opened" | "read" | "used" | "rejected" | "failed";

export type ResearchEvidence = {
  sourceId: string;
  query: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  sourceState: ResearchSourceState;
  failureReason?: string;
};

export type ResearchResult = {
  query: string;
  plan: string[];
  evidence: ResearchEvidence[];
  report: string;
  sources: WebSource[];
  partialFailures: string[];
};

export type ResearchProgressEvent = {
  stage: ResearchStage;
  progress: number;
  activity?: ToolActivityEvent;
};

type ResearchInsertResult = PromiseLike<{ error?: unknown }> & {
  select: (columns: string) => {
    maybeSingle: () => Promise<{ data?: { id?: string } | null; error?: unknown }>;
  };
};

type ResearchPersistenceClient = {
  from: (table: string) => {
    insert: (values: JsonObject | JsonObject[]) => ResearchInsertResult;
    update: (values: JsonObject) => {
      eq: (column: string, value: string) => Promise<{ error?: unknown }>;
    };
  };
};

export type ResearchPersistence = {
  supabase: ResearchPersistenceClient;
  userId: string;
  chatId?: string;
  projectId?: string;
  temporary?: boolean;
};

async function createResearchRun(
  persistence: ResearchPersistence | undefined,
  query: string,
): Promise<string | null> {
  if (!persistence || persistence.temporary) return null;
  try {
    const { data, error } = await persistence.supabase
      .from("deep_research_runs")
      .insert({
        user_id: persistence.userId,
        chat_id: persistence.chatId,
        project_id: persistence.projectId,
        query,
        status: "running",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("[deep-research] failed to create run", error);
      return null;
    }
    return typeof data?.id === "string" ? data.id : null;
  } catch (error) {
    console.warn("[deep-research] failed to create run", error);
    return null;
  }
}

async function updateResearchRun(
  persistence: ResearchPersistence | undefined,
  runId: string | null,
  values: JsonObject,
): Promise<boolean> {
  if (!persistence || !runId || persistence.temporary) return true;
  try {
    const { error } = await persistence.supabase
      .from("deep_research_runs")
      .update(values)
      .eq("id", runId);
    if (error) {
      console.warn("[deep-research] failed to update run", error);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[deep-research] failed to update run", error);
    return false;
  }
}

async function persistTerminalResearchRun(
  persistence: ResearchPersistence | undefined,
  runId: string | null,
  values: JsonObject,
): Promise<boolean> {
  if (await updateResearchRun(persistence, runId, values)) return true;
  // Terminal state is the durable source of truth. Retry once so a transient
  // transport failure does not strand an otherwise completed run as running.
  return updateResearchRun(persistence, runId, values);
}

async function insertResearchEvidence(
  persistence: ResearchPersistence | undefined,
  runId: string | null,
  evidence: ResearchEvidence[],
): Promise<void> {
  if (!persistence || !runId || persistence.temporary || evidence.length === 0) return;
  try {
    const insert = persistence.supabase.from("deep_research_evidence").insert(
      evidence.map((item) => ({
        run_id: runId,
        user_id: persistence.userId,
        source_id: item.sourceId,
        query: item.query,
        title: item.title,
        url: item.url,
        domain: item.domain,
        snippet: item.snippet,
      })),
    );
    const { error } = await insert;
    if (error) console.warn("[deep-research] failed to insert evidence", error);
  } catch (error) {
    console.warn("[deep-research] failed to insert evidence", error);
  }
}

const MAX_PLAN_QUERIES = 5;
const MAX_EVIDENCE = 12;

function sanitizeResearchText(text: string, max = 1200): string {
  return replaceControlCharacters(text).replace(/\s+/g, " ").trim().slice(0, max);
}

function fallbackPlan(query: string): string[] {
  const q = sanitizeResearchText(query, 220);
  return [q, `${q} latest primary sources`, `${q} expert analysis`];
}

function parsePlan(raw: string, originalQuery: string): string[] {
  const cleaned = raw.trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Provider may return a plain list; handle it below.
  }
  const candidates = Array.isArray(parsed)
    ? parsed
    : cleaned
        .split(/\n+/)
        .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
        .filter(Boolean);
  const plan = candidates
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizeResearchText(item, 180))
    .filter(Boolean)
    .slice(0, MAX_PLAN_QUERIES);
  return plan.length ? Array.from(new Set(plan)) : fallbackPlan(originalQuery);
}

async function makePlan(query: string, signal?: AbortSignal): Promise<string[]> {
  const upstream = await chatCompletions(
    {
      model: modelForRole("UTILITY"),
      max_completion_tokens: UTILITY_MAX_OUTPUT_TOKENS,

      messages: [
        {
          role: "system",
          content:
            "Create a concise deep-research search plan. Return only a JSON array of 3 to 5 distinct web search queries. Do not include commentary.",
        },
        { role: "user", content: sanitizeResearchText(query, 1000) },
      ],
      temperature: 0.2,
    },
    { signal },
  );
  if (!upstream.ok) throw await providerErrorFromResponse(upstream);
  const json = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parsePlan(json.choices?.[0]?.message?.content ?? "", query);
}

function buildEvidence(
  plan: string[],
  sourceGroups: Array<{ query: string; sources: WebSource[] }>,
): { evidence: ResearchEvidence[]; sources: WebSource[] } {
  const evidence: ResearchEvidence[] = [];
  const sourcesByUrl = new Map<string, WebSource>();
  for (const group of sourceGroups) {
    for (const source of group.sources) {
      const key = source.url.toLowerCase().replace(/\/$/, "");
      if (!sourcesByUrl.has(key))
        sourcesByUrl.set(key, { ...source, id: `src-${sourcesByUrl.size + 1}` });
      const canonical = sourcesByUrl.get(key)!;
      if (evidence.length < MAX_EVIDENCE) {
        evidence.push({
          sourceId: canonical.id,
          query: group.query,
          title: canonical.title,
          url: canonical.url,
          domain: canonical.domain,
          snippet: canonical.snippet,
          sourceState: canonical.snippet ? "read" : "discovered",
        });
      }
    }
  }
  const sources = Array.from(sourcesByUrl.values());
  return { evidence, sources };
}

function evidencePrompt(query: string, plan: string[], evidence: ResearchEvidence[]): string {
  const sourceLines = evidence.map(
    (item) =>
      `[${item.sourceId}] Query: ${item.query}\nTitle: ${item.title}\nURL: ${item.url}\nDomain: ${item.domain}\nEvidence: ${item.snippet}`,
  );
  return `Research question: ${sanitizeResearchText(query, 1000)}\n\nPlan:\n${plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nEvidence:\n${sourceLines.join("\n\n")}`;
}

async function writeReport(
  query: string,
  plan: string[],
  evidence: ResearchEvidence[],
  signal?: AbortSignal,
): Promise<string> {
  const upstream = await chatCompletions(
    {
      model: modelForRole("PREMIUM_REASONING"),
      messages: [
        {
          role: "system",
          content:
            "Write a structured deep-research report from the provided evidence only. Include concise headings, explicitly note uncertainty, and cite factual claims with Markdown links whose labels name the source and whose URLs exactly match the evidence. Do not invent citations, sources, or URLs. End with a Sources section that lists each cited source id, title, and exact URL as a Markdown link.",
        },
        { role: "user", content: evidencePrompt(query, plan, evidence) },
      ],
      temperature: 0.2,
    },
    { signal },
  );
  if (!upstream.ok) throw await providerErrorFromResponse(upstream);
  const json = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const report = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!report) throw new Error("empty_research_report");
  return report;
}

export async function runDeepResearch(
  query: string,
  opts: {
    signal?: AbortSignal;
    onProgress?: (event: ResearchProgressEvent) => void | Promise<void>;
    persistence?: ResearchPersistence;
  } = {},
): Promise<ResearchResult> {
  const safeQuery = sanitizeResearchText(query, 1000);
  if (!safeQuery) throw new Error("empty_research_query");
  const emit = async (stage: ResearchStage, progress: number, activity?: ToolActivityEvent) => {
    await opts.onProgress?.({ stage, progress, activity });
  };

  const runId = await createResearchRun(opts.persistence, safeQuery);
  try {
    await emit(
      { id: "created", label: "Created research run", status: "created", detail: safeQuery },
      0.05,
    );
    await emit(
      { id: "intake", label: "Scope research question", status: "complete", detail: safeQuery },
      0.1,
    );
    await emit(
      { id: "planning", label: "Create research plan", status: "running" },
      0.2,
      createToolActivityEvent("research_plan", "Creating research plan", "running"),
    );
    let plan: string[];
    try {
      plan = await makePlan(safeQuery, opts.signal);
    } catch (error) {
      if (opts.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      plan = fallbackPlan(safeQuery);
    }
    await updateResearchRun(opts.persistence, runId, { plan });
    await emit(
      {
        id: "planning",
        label: "Create research plan",
        status: "complete",
        detail: `${plan.length} search queries`,
      },
      0.32,
      createToolActivityEvent("research_plan", "Research plan ready", "complete", {
        metadata: { queries: plan.length },
      }),
    );

    await emit(
      { id: "searching", label: "Search multiple source sets", status: "running" },
      0.38,
      createToolActivityEvent("search_web", "Searching web", "running"),
    );
    const partialFailures: string[] = [];
    const sourceGroups = await Promise.all(
      plan.map(async (searchQuery) => {
        const response = await searchWeb(searchQuery, {
          wantsNews: true,
          limit: 4,
          signal: opts.signal,
        });
        if (response.status !== "ok")
          partialFailures.push(`${searchQuery}: ${response.error ?? response.status}`);
        return { query: searchQuery, sources: response.sources };
      }),
    );
    await emit(
      {
        id: "searching",
        label: "Search multiple source sets",
        status: "complete",
        detail: `${sourceGroups.reduce((n, g) => n + g.sources.length, 0)} raw sources`,
      },
      0.58,
      createToolActivityEvent("search_web", "Web search complete", "complete"),
    );

    await emit(
      { id: "reading", label: "Read and dedupe evidence", status: "running" },
      0.64,
      createToolActivityEvent("read_source", "Reading source snippets", "running"),
    );
    await emit(
      { id: "comparing", label: "Compare source coverage", status: "running" },
      0.68,
      createToolActivityEvent("compare_sources", "Comparing sources", "running"),
    );
    await emit({ id: "analyzing", label: "Analyze evidence", status: "running" }, 0.72);
    const { evidence, sources } = buildEvidence(plan, sourceGroups);
    if (!evidence.length) throw new Error(partialFailures[0] ?? "no_research_sources");
    await insertResearchEvidence(opts.persistence, runId, evidence);
    await updateResearchRun(opts.persistence, runId, { evidence, sources });
    await emit(
      {
        id: "analyzing",
        label: "Extract and dedupe evidence",
        status: "complete",
        detail: `${evidence.length} evidence notes`,
      },
      0.76,
      createToolActivityEvent("read_source", "Evidence ready", "complete", {
        metadata: { evidence: evidence.length },
      }),
    );

    await emit(
      { id: "writing_report", label: "Write cited report", status: "running" },
      0.84,
      createToolActivityEvent("write_report", "Writing cited report", "running"),
    );
    const report = await writeReport(safeQuery, plan, evidence, opts.signal);
    const completionPersisted = await persistTerminalResearchRun(opts.persistence, runId, {
      status: "complete",
      report,
      sources,
      partial_failures: partialFailures,
      completed_at: new Date().toISOString(),
    });
    if (!completionPersisted) {
      throw new Error("Research completed, but its report could not be saved. Try again.");
    }
    try {
      await emit(
        { id: "complete", label: "Research complete", status: "complete" },
        1,
        createToolActivityEvent("write_report", "Cited report complete", "complete"),
      );
    } catch (progressError) {
      // Observer delivery happens after durable completion and cannot turn a
      // completed run into a failed one.
      console.warn("[deep-research] completion progress delivery failed", progressError);
    }

    return { query: safeQuery, plan, evidence, report, sources, partialFailures };
  } catch (error) {
    const canceled =
      Boolean(opts.signal?.aborted) || (error instanceof Error && error.name === "AbortError");
    const status = canceled ? "canceled" : "failed";
    const completedAt = new Date().toISOString();
    const persistenceFailure =
      error instanceof Error && error.message.startsWith("Research completed, but its report");
    const terminalPersisted = await persistTerminalResearchRun(opts.persistence, runId, {
      status,
      error: canceled
        ? "Research was canceled by the user."
        : persistenceFailure
          ? "Research completed, but its report could not be saved."
          : "Research could not complete because search or the AI provider failed.",
      completed_at: completedAt,
    });
    if (!terminalPersisted) {
      console.error("[deep-research] terminal state could not be persisted", { runId, status });
    }
    try {
      await emit(
        {
          id: status,
          label: canceled ? "Research canceled" : "Research failed",
          status,
        },
        1,
        createToolActivityEvent(
          "write_report",
          canceled ? "Research canceled" : "Research failed",
          status,
        ),
      );
    } catch {
      // A progress-stream failure must not prevent terminal persistence.
    }
    throw error;
  }
}
