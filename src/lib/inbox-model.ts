export type InboxProvider = "gmail" | "outlook";
export type InboxFolder = "inbox" | "trash";
export type InboxAccount = {
  id: string;
  provider: InboxProvider;
  label: string;
  canModify: boolean;
  canReply: boolean;
};
export type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  preview: string;
  date: string;
  unread: boolean;
  body?: string;
};
export type InboxPage = { messages: InboxMessage[]; next: string | null };
