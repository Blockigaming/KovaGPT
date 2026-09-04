import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { PendingAttachment } from "@/components/ChatInput";
import { saveImageToLibrary } from "@/lib/library-images.functions";
import { saveToLibrary } from "@/lib/library.functions";

type AcceptedAttachment = PendingAttachment & {
  clientId?: string;
  source?: "file_upload" | "long_paste" | "library";
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function eligibleAttachment(
  attachment: PendingAttachment,
): attachment is AcceptedAttachment & { clientId: string } {
  const candidate = attachment as AcceptedAttachment;
  return Boolean(
    candidate.status === "complete" &&
    candidate.clientId &&
    UUID_PATTERN.test(candidate.clientId) &&
    (candidate.source === "file_upload" || candidate.source === "long_paste") &&
    (candidate.kind === "image" || candidate.kind === "text_file"),
  );
}

export function useLibraryAttachmentAutoSave({
  enabled,
  principalKey,
}: {
  enabled: boolean;
  principalKey: string | null;
}): {
  onAttachmentAccepted: (attachment: PendingAttachment) => void;
} {
  const saveItem = useServerFn(saveToLibrary);
  const saveImage = useServerFn(saveImageToLibrary);
  const principalRef = useRef(principalKey);
  const enabledRef = useRef(enabled);
  const completedRef = useRef(new Set<string>());
  const inFlightRef = useRef(new Set<string>());

  principalRef.current = principalKey;
  enabledRef.current = enabled;

  useEffect(() => {
    completedRef.current.clear();
    inFlightRef.current.clear();
  }, [principalKey]);

  const persist = useCallback(
    async (attachment: PendingAttachment) => {
      if (
        !enabled ||
        !enabledRef.current ||
        !principalKey ||
        principalRef.current !== principalKey ||
        !eligibleAttachment(attachment)
      ) {
        return;
      }

      const operationKey = `${principalKey}:${attachment.clientId}`;
      if (completedRef.current.has(operationKey) || inFlightRef.current.has(operationKey)) {
        return;
      }

      inFlightRef.current.add(operationKey);
      try {
        if (attachment.kind === "image") {
          await saveImage({
            data: {
              imageUrl: attachment.dataUrl,
              title: attachment.name.slice(0, 200) || "Uploaded image",
              source: "upload",
              idempotencyKey: attachment.clientId,
            },
          });
        } else {
          await saveItem({
            data: {
              title: attachment.name.slice(0, 200) || "Uploaded file",
              item_type: "upload",
              source: "upload",
              content_text: attachment.textContent ?? "",
              file_name: attachment.name.slice(0, 300),
              file_type: attachment.fileType?.slice(0, 100) ?? null,
              file_size: attachment.size ?? null,
              idempotencyKey: attachment.clientId,
            },
          });
        }

        if (principalRef.current === principalKey) {
          completedRef.current.add(operationKey);
        }
      } catch {
        if (principalRef.current === principalKey) {
          toast.error("This attachment was not saved to your Library.", {
            action: {
              label: "Retry",
              onClick: () => void persist(attachment),
            },
          });
        }
      } finally {
        inFlightRef.current.delete(operationKey);
      }
    },
    [enabled, principalKey, saveImage, saveItem],
  );

  const onAttachmentAccepted = useCallback(
    (attachment: PendingAttachment) => {
      void persist(attachment);
    },
    [persist],
  );

  return { onAttachmentAccepted };
}
