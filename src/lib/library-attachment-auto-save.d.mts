import type { PendingAttachment } from "@/components/ChatInput";
export type AttachmentSaveScope = { principal: string | null; enabled: boolean };
export function createLibraryAttachmentAutoSaver(options: {
  getScope: () => AttachmentSaveScope;
  saveImage: (args: {
    data: { imageUrl: string; title: string; source: "upload"; idempotencyKey: string };
  }) => Promise<unknown>;
  saveText: (args: {
    data: {
      title: string;
      item_type: "upload";
      source: "upload";
      content_text: string;
      file_name: string;
      file_type: string;
      file_size?: number;
      idempotencyKey: string;
    };
  }) => Promise<unknown>;
  onError: (name: string, retry: () => Promise<void>) => void;
}): (attachment: PendingAttachment, scope?: AttachmentSaveScope) => Promise<void>;
