// Non-streaming text transformation endpoint for the Writing workspace.
// Accepts { text, action, instructions?, tone? } and returns { text }.
import { createFileRoute } from "@tanstack/react-router";
import { chatCompletions, chatModel, missingAiProviderResponse } from "@/lib/ai/provider.server";
import {
  requireUser,
  assertNotBanned,
  assertFeatureEnabled,
  enforceQuota,
  getCallerTier,
} from "@/lib/api-auth.server";
import { DAILY_CHAT_LIMIT_BY_TIER } from "@/lib/modes";

type Action =
  "improve" | "expand" | "shorten" | "grammar" | "continue" | "tone" | "outline" | "custom";

type Body = {
  text?: string;
  action?: Action;
  instructions?: string;
  tone?: string;
};

const PROMPTS: Record<Exclude<Action, "custom" | "tone">, string> = {
  improve:
    "Improve the following text. Keep the author's meaning and voice, tighten prose, fix grammar, and return only the improved version - no preamble.",
  expand:
    "Expand the following text with more depth, examples, and detail while preserving voice. Return only the expanded version.",
  shorten:
    "Shorten the following text by about 40% while keeping the key points and voice. Return only the shortened version.",
  grammar:
    "Fix grammar, spelling, and punctuation in the following text. Do not change wording or style otherwise. Return only the corrected version.",
  continue:
    "Continue writing from where the following text ends. Match voice, tense, and style. Return ONLY the new continuation, not the original text.",
  outline:
    "Turn the following text (or topic) into a clean outline with H2/H3 sections and short bullet points. Return only the outline in markdown.",
};

export const Route = createFileRoute("/api/write")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        // Same protections as /api/chat and /api/generate-image: refuse banned
        // users, respect the chat maintenance flag, and enforce a per-user
        // daily cap so this endpoint can't be scripted into an unlimited
        // AI-gateway spender.
        const banned = await assertNotBanned(auth);
        if (banned) return banned;
        const maint = await assertFeatureEnabled(auth, "chat");
        if (maint) return maint;
        const tier = await getCallerTier(auth);
        const quota = await enforceQuota(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER[tier]);
        if (quota) return quota;

        let body: Body = {};
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const text = (body.text ?? "").slice(0, 40_000);
        const action = body.action ?? "improve";
        if (!text.trim() && action !== "custom" && action !== "outline") {
          return Response.json({ error: "empty_text" }, { status: 400 });
        }

        let instruction = "";
        if (action === "tone") {
          const tone = (body.tone ?? "professional").slice(0, 60);
          instruction = `Rewrite the following text in a ${tone} tone. Keep meaning intact. Return only the rewritten version.`;
        } else if (action === "custom") {
          instruction = (body.instructions ?? "").slice(0, 2000).trim();
          if (!instruction)
            return Response.json({ error: "missing_instructions" }, { status: 400 });
        } else {
          instruction = PROMPTS[action];
        }

        const missingProvider = missingAiProviderResponse();
        if (missingProvider) return missingProvider;

        const upstream = await chatCompletions({
          model: chatModel("balanced"),
          messages: [
            {
              role: "system",
              content:
                "You are a precise writing assistant. Return only the requested text with no commentary, no headings like 'Here is', and no code fences unless the source used them.",
            },
            {
              role: "user",
              content: `${instruction}\n\n---\n${text}`,
            },
          ],
        });

        if (!upstream.ok) {
          const errBody = await upstream.text();
          console.error(`[write] gateway ${upstream.status}: ${errBody}`);
          return Response.json(
            { error: `ai_failed_${upstream.status}` },
            { status: upstream.status === 429 ? 429 : 502 },
          );
        }

        const json = (await upstream.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const out = json.choices?.[0]?.message?.content ?? "";
        return Response.json({ text: out.trim() });
      },
    },
  },
});
