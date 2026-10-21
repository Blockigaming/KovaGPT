import { useRef, useState } from "react";
import { CanvasComments } from "@/components/CanvasComments";
import type { CanvasSnapshot } from "@/lib/collaboration";

const actor = "22222222-2222-4222-8222-222222222222";
const initial: CanvasSnapshot = {
  document: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    private_owner_id: actor,
    project_id: null,
    chat_id: "sample-chat",
    message_id: "sample-message",
    content: "A local sample result for checking comment controls.",
    revision: 1,
    comment_epoch: 0,
    updated_at: "2026-10-19T00:00:00Z",
  },
  canEdit: true,
  canManageComments: true,
  deletedCommentIds: [],
  versions: [],
  comments: [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      author_id: actor,
      body: "Sample comment: make the introduction shorter.",
      anchor: null,
      created_at: "2026-10-19T00:00:00Z",
    },
  ],
};

export function ResultCommentsPreview() {
  const [snapshot, setSnapshot] = useState(initial);
  const failDeletion = useRef(true);
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Result comments control review</h1>
      <p className="text-sm text-muted-foreground">
        The actual comment component with disposable sample data. The first confirmed deletion
        fails; retry affects only this sample. No document, account or provider request is made.
        Reset sample restores the original comment and failure.
      </p>
      <div className="rounded-xl border p-4">
        <CanvasComments
          snapshot={snapshot}
          value={snapshot.document.content}
          actorId={actor}
          dirty={false}
          selection={() => null}
          onSelect={() => {}}
          onOlder={async () => {}}
          onComment={async (data) => {
            const id = String(data.commentId);
            setSnapshot((previous) =>
              previous.comments.some((comment) => comment.id === id)
                ? previous
                : {
                    ...previous,
                    comments: [
                      ...previous.comments,
                      {
                        id,
                        author_id: actor,
                        body: String(data.body),
                        anchor: null,
                        created_at: new Date().toISOString(),
                      },
                    ],
                  },
            );
          }}
          onDelete={async (id) => {
            if (failDeletion.current) {
              failDeletion.current = false;
              throw new Error("Synthetic deletion failure; this sample is unchanged.");
            }
            setSnapshot((previous) => ({
              ...previous,
              comments: previous.comments.filter((comment) => comment.id !== id),
            }));
          }}
        />
      </div>
    </section>
  );
}
