import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { InboxAccount, InboxMessage, InboxPage } from "@/lib/inbox-model";

const ownerInput = z.object({ owner: z.string().min(1).max(128) });
const accountInput = ownerInput.extend({
  provider: z.enum(["gmail", "outlook"]),
  account: z.string().uuid(),
});
const messageInput = accountInput.extend({ id: z.string().min(1).max(512) });

export const listInboxAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(ownerInput)
  .handler(async ({ context, data }): Promise<InboxAccount[]> => {
    const { listInboxAccountsServer } = await import("./inbox.server");
    return listInboxAccountsServer(data, { userId: context.userId });
  });

export const listInboxMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    accountInput.extend({
      folder: z.enum(["inbox", "trash"]),
      cursor: z.string().max(2048).nullable(),
    }),
  )
  .handler(async ({ context, data }): Promise<InboxPage> => {
    const { listInboxMessagesServer } = await import("./inbox.server");
    return listInboxMessagesServer(data, { userId: context.userId });
  });

export const readInboxMessage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(messageInput)
  .handler(async ({ context, data }): Promise<InboxMessage> => {
    const { readInboxMessageServer } = await import("./inbox.server");
    return readInboxMessageServer(data, { userId: context.userId });
  });

export const updateInboxMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    messageInput.extend({
      action: z.enum(["read", "unread", "trash", "restore"]),
      confirmed: z.literal(true),
    }),
  )
  .handler(async ({ context, data }) => {
    const { updateInboxMessageServer } = await import("./inbox.server");
    return updateInboxMessageServer(data, { userId: context.userId });
  });

export const replyInboxMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    messageInput.extend({
      body: z.string().trim().min(1).max(20_000),
      confirmed: z.literal(true),
    }),
  )
  .handler(async ({ context, data }) => {
    const { replyInboxMessageServer } = await import("./inbox.server");
    return replyInboxMessageServer(data, { userId: context.userId });
  });
