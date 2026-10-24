// PRIVATE REVIEW ONLY. Fixed inert response content; never a model/provider call.
export const GENERATIVE_UI_REVIEW_SCENARIO = "chat-generative-canvas-review";
export const GENERATIVE_UI_REVIEW_CHAT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc55";
export const GENERATIVE_UI_REVIEW_OPTION = Object.freeze({
  id: GENERATIVE_UI_REVIEW_SCENARIO,
  label: "chat-generative-canvas-review · five synthetic editable widget drafts",
  accounts: Object.freeze(["free", "plus", "pro"]),
  path: "/",
});
export const GENERATIVE_UI_REVIEW_DISCLOSURE =
  "chat-generative-canvas-review opens a separate synthetic conversation with all five supported kova-ui draft types: document, code, date, timeline and board. Widget edits are session-local drafts. Dates do not book anything; timeline status changes and board moves do not execute tasks. Code stays inert source text. The ordinary explicit Canvas Save/export controls retain the existing private review boundaries; editing a widget does not save to an account. Reset discards this disposable session. No live model, provider or real account data is connected.";

export function generativeUiReviewWidgets() {
  // Fresh nested data on each call keeps independent resets/reviewers isolated.
  return [
    {
      version: 1,
      type: "document",
      title: "Draft · Sample release note",
      content:
        "# Sample release note\n\nThe fictional workspace now supports editable drafts.\n\n- Review the wording.\n- Compare revisions before using the text.\n- Keep the final decision with the reviewer.\n\nThis is synthetic local review content.",
    },
    {
      version: 1,
      type: "code",
      title: "Draft · Checklist formatter",
      language: "javascript",
      content:
        'export function formatChecklist(items) {\n  return items.map((item, index) => `${index + 1}. ${item}`).join("\\n");\n}\n',
    },
    {
      version: 1,
      type: "date",
      title: "Draft · Sample review date",
      value: "2026-11-02",
      min: "2026-10-21",
      max: "2026-12-31",
    },
    {
      version: 1,
      type: "timeline",
      title: "Draft · Fictional review timeline",
      items: [
        {
          id: "prepare",
          title: "Prepare sample draft",
          start: "2026-11-02",
          end: "2026-11-02",
          status: "done",
        },
        {
          id: "inspect",
          title: "Inspect editable widgets",
          start: "2026-11-03",
          end: "2026-11-04",
          status: "doing",
        },
        {
          id: "review",
          title: "Record reviewer feedback",
          start: "2026-11-05",
          end: "2026-11-06",
          status: "planned",
        },
      ],
    },
    {
      version: 1,
      type: "board",
      title: "Draft · Fictional ideas board",
      columns: [
        { id: "ideas", title: "Ideas" },
        { id: "exploring", title: "Exploring" },
        { id: "reviewed", title: "Reviewed" },
      ],
      cards: [
        {
          id: "clear-copy",
          title: "Clearer sample wording",
          columnId: "ideas",
          body: "Edit this synthetic card without creating a real task.",
        },
        {
          id: "canvas-flow",
          title: "Inspect the Canvas flow",
          columnId: "exploring",
          body: "Move between the inline draft and its editing workspace.",
        },
        {
          id: "draft-labels",
          title: "Keep draft labels visible",
          columnId: "reviewed",
          body: "Review status is local to this disposable sample.",
        },
      ],
    },
  ];
}

export function generativeUiReviewConversation() {
  return {
    id: GENERATIVE_UI_REVIEW_CHAT_ID,
    title: "Sample · Editable canvas drafts",
    mode: "instant",
    createdAt: 1792238400000,
    updatedAt: 1792238400000,
    messages: generativeUiReviewWidgets().flatMap((widget) => [
      {
        id: `canvas-${widget.type}-prompt`,
        role: "user",
        content: `Show a fictional ${widget.type} draft for private interface review. Use only the supplied sample content and dates.`,
      },
      {
        id: `canvas-${widget.type}-answer`,
        role: "assistant",
        content: `Synthetic local draft: edit this ${widget.type} directly. Nothing is booked, sent or executed.\n\n\`\`\`kova-ui\n${JSON.stringify(widget, null, 2)}\n\`\`\``,
      },
    ]),
  };
}
