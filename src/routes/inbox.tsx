import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bell, Check, Mail, RefreshCw, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import { useInboxAccounts } from "@/hooks/use-inbox-accounts";
import { loadSettings } from "@/lib/use-nova-settings";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";
import {
  listInboxMessages,
  readInboxMessage,
  replyInboxMessage,
  updateInboxMessage,
} from "@/lib/inbox.functions";
import {
  listNotifications,
  markNotificationsRead,
  type CenterNotification,
} from "@/lib/notification-center.functions";
import type { InboxAccount, InboxFolder, InboxMessage } from "@/lib/inbox-model";
import "@/styles/inbox.css";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [{ title: "Inbox · KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
  component: InboxRoute,
});

function InboxRoute() {
  const { isLoaded, isSignedIn, user } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : undefined;
  return (
    <AppShell>
      <main className="kova-inbox">
        <h1>Inbox</h1>
        {!isLoaded ? (
          <p role="status">Loading your account…</p>
        ) : owner ? (
          <OwnerInbox key={owner} owner={owner} />
        ) : (
          <p>Sign in and connect Gmail or Outlook to use Inbox.</p>
        )}
      </main>
    </AppShell>
  );
}

function OwnerInbox({ owner }: { owner: string }) {
  const { accounts, loading, error } = useInboxAccounts(owner);
  const [selected, setSelected] = useState("");
  const [folder, setFolder] = useState<InboxFolder>("inbox");
  const [preferences, setPreferences] = useState(DEFAULT_SETTINGS);
  const account = accounts.find((item) => item.id === selected) ?? accounts[0];
  useEffect(() => {
    const refresh = () => setPreferences(loadSettings(owner));
    refresh();
    const saved = (event: Event) => {
      if ((event as CustomEvent<{ ownerId: string }>).detail?.ownerId === owner) refresh();
    };
    window.addEventListener("kova:settings-saved", saved);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("kova:settings-saved", saved);
      window.removeEventListener("storage", refresh);
    };
  }, [owner]);
  if (loading) return <p role="status">Checking mail connections…</p>;
  if (error) return <p role="alert">Mail connection status is unavailable. Reopen Inbox to retry.</p>;
  if (!account)
    return (
      <section className="kova-inbox-empty">
        <Mail aria-hidden="true" />
        <h2>Connect your email</h2>
        <p>Inbox is available when an eligible Gmail or Outlook account is connected.</p>
        <Link to="/apps" className="underline">
          Open Connections
        </Link>
      </section>
    );
  return (
    <>
      <div className="kova-inbox-controls">
        <div role="group" aria-label="Mail folders" className="kova-inbox-folders">
          <button
            type="button"
            aria-pressed={folder === "inbox"}
            onClick={() => setFolder("inbox")}
          >
            <Mail aria-hidden="true" /> Inbox
          </button>
          <button
            type="button"
            aria-pressed={folder === "trash"}
            onClick={() => setFolder("trash")}
          >
            <Trash2 aria-hidden="true" /> Trash
          </button>
        </div>
        <label className="kova-inbox-account">
          <span className="sr-only">Mail account</span>
          <select value={account.id} onChange={(event) => setSelected(event.target.value)}>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} · {item.provider === "gmail" ? "Gmail" : "Outlook"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Mailbox
        key={`${account.provider}:${account.id}:${folder}`}
        owner={owner}
        account={account}
        folder={folder}
        compact={preferences.inboxDensity === "compact"}
        showPreview={preferences.inboxShowPreview !== false}
        unreadFirst={preferences.inboxUnreadFirst === true}
      />
    </>
  );
}

type Row = { kind: "mail"; message: InboxMessage } | { kind: "notice"; notice: CenterNotification };

function Mailbox({
  owner,
  account,
  folder,
  compact,
  showPreview,
  unreadFirst,
}: {
  owner: string;
  account: InboxAccount;
  folder: InboxFolder;
  compact: boolean;
  showPreview: boolean;
  unreadFirst: boolean;
}) {
  const list = useServerFn(listInboxMessages);
  const read = useServerFn(readInboxMessage);
  const update = useServerFn(updateInboxMessage);
  const reply = useServerFn(replyInboxMessage);
  const notifications = useServerFn(listNotifications);
  const markNoticeRead = useServerFn(markNotificationsRead);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [notices, setNotices] = useState<CenterNotification[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<Row | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(false);
  const operation = useRef(false);
  const target = { owner, account: account.id, provider: account.provider };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void list({
      data: { owner, account: account.id, provider: account.provider, folder, cursor: null },
    })
      .then((page) => {
        if (!active) return;
        setMessages(page.messages);
        setNext(page.next);
      })
      .catch(() => {
        if (active) setError("Messages could not be loaded. Refresh Inbox or check Connections.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [owner, account.id, account.provider, folder, list, refresh]);

  useEffect(() => {
    if (folder !== "inbox") return;
    let active = true;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      try {
        const items = await notifications();
        if (active && request === revision) {
          setNotices(items);
          setNoticeError(false);
        }
      } catch {
        if (active && request === revision) setNoticeError(true);
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [folder, notifications, refresh]);

  const changeUnread = (id: string, unread: boolean) => {
    setMessages((previous) => previous.map((item) => (item.id === id ? { ...item, unread } : item)));
    setOpened((previous) =>
      previous?.kind === "mail" && previous.message.id === id
        ? { kind: "mail", message: { ...previous.message, unread } }
        : previous,
    );
  };
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (mounted.current)
        setError("The request could not be confirmed. Check your email provider before retrying.");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function open(row: Row) {
    if (operation.current) return;
    setOpened(null);
    setDraft("");
    void run(async () => {
      if (row.kind === "notice") {
        setOpened(row);
        if (!row.notice.readAt) {
          const result = await markNoticeRead({
            data: { ids: [row.notice.id], source: row.notice.source },
          });
          if (!mounted.current || !result.ok) return;
          const notice = { ...row.notice, readAt: new Date().toISOString() };
          setNotices((previous) => previous.map((item) => (item.id === notice.id ? notice : item)));
          setOpened({ kind: "notice", notice });
        }
        return;
      }
      const message = await read({ data: { ...target, id: row.message.id } });
      if (!mounted.current) return;
      setOpened({ kind: "mail", message });
      if (message.unread && account.canModify && folder === "inbox") {
        const result = await update({
          data: { ...target, id: message.id, action: "read", confirmed: true },
        });
        if (mounted.current && result.ok) changeUnread(message.id, false);
      }
    });
  }
  function mutate(message: InboxMessage, action: "read" | "unread" | "trash" | "restore") {
    void run(async () => {
      const result = await update({
        data: { ...target, id: message.id, action, confirmed: true },
      });
      if (!mounted.current || !result.ok) return;
      if (action === "read" || action === "unread") {
        changeUnread(message.id, action === "unread");
      } else {
        setMessages((previous) => previous.filter((item) => item.id !== message.id));
        setOpened(null);
        setDraft("");
      }
    });
  }
  function send(message: InboxMessage) {
    if (!draft.trim()) return;
    void run(async () => {
      const result = await reply({
        data: { ...target, id: message.id, body: draft, confirmed: true },
      });
      if (!mounted.current || !result.sent) return;
      setDraft("");
      toast.success("Email sent");
    });
  }
  function loadMore() {
    if (!next) return;
    void run(async () => {
      const page = await list({ data: { ...target, folder, cursor: next } });
      if (!mounted.current) return;
      setMessages((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [...previous, ...page.messages.filter((item) => !existing.has(item.id))];
      });
      setNext(page.next);
    });
  }
  const rows: Row[] = [
    ...messages.map((message): Row => ({ kind: "mail", message })),
    ...(folder === "inbox" ? notices.map((notice): Row => ({ kind: "notice", notice })) : []),
  ];
  const unread = (row: Row) => (row.kind === "mail" ? row.message.unread : !row.notice.readAt);
  const date = (row: Row) => (row.kind === "mail" ? row.message.date : row.notice.createdAt);
  const visible = rows
    .filter((row) => {
      const text =
        row.kind === "mail"
          ? `${row.message.from} ${row.message.subject} ${row.message.preview}`
          : `KovaGPT ${row.notice.title} ${row.notice.preview}`;
      return text.toLowerCase().includes(search.toLowerCase());
    })
    .sort(
      (a, b) =>
        (unreadFirst ? Number(unread(b)) - Number(unread(a)) : 0) ||
        date(b).localeCompare(date(a)),
    );

  return (
    <section className="kova-inbox-panel" data-density={compact ? "compact" : "comfortable"}>
      {error && (
        <p role="alert" className="kova-inbox-error">
          {error}
        </p>
      )}
      {noticeError && (
        <p role="status" className="kova-inbox-error">
          Kova notifications are temporarily unavailable.
        </p>
      )}
      {opened ? (
        <article className="kova-inbox-detail">
          <div className="kova-inbox-toolbar">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpened(null);
                setDraft("");
              }}
            >
              <ArrowLeft aria-hidden="true" /> Back
            </Button>
            {opened.kind === "mail" && account.canModify && (
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => mutate(opened.message, opened.message.unread ? "read" : "unread")}
                >
                  {opened.message.unread ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Mail aria-hidden="true" />
                  )}
                  Mark {opened.message.unread ? "read" : "unread"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => mutate(opened.message, folder === "trash" ? "restore" : "trash")}
                >
                  <Trash2 aria-hidden="true" /> {folder === "trash" ? "Restore" : "Move to Trash"}
                </Button>
              </>
            )}
          </div>
          {opened.kind === "notice" ? (
            <>
              <h2>{opened.notice.title}</h2>
              <p className="kova-inbox-meta">KovaGPT · {formatDate(opened.notice.createdAt)}</p>
              <p className="kova-inbox-body">{opened.notice.preview}</p>
              <Link to="/notifications" className="underline">
                View notifications
              </Link>
            </>
          ) : (
            <>
              <h2>{opened.message.subject}</h2>
              <p className="kova-inbox-meta">
                {opened.message.from} · {formatDate(opened.message.date)}
              </p>
              <p className="kova-inbox-body">
                {opened.message.body || opened.message.preview || "No plain-text body available."}
              </p>
              {folder === "inbox" &&
                (account.canReply ? (
                  <form
                    className="kova-inbox-reply"
                    onSubmit={(event) => {
                      event.preventDefault();
                      send(opened.message);
                    }}
                  >
                    <label htmlFor="kova-inbox-reply">Reply to sender</label>
                    <textarea
                      id="kova-inbox-reply"
                      value={draft}
                      maxLength={20_000}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Write a reply…"
                      disabled={busy}
                    />
                    <Button type="submit" disabled={busy || !draft.trim()}>
                      <Send aria-hidden="true" /> Send
                    </Button>
                  </form>
                ) : (
                  <p className="kova-inbox-meta">
                    Enable send permission in{" "}
                    <Link to="/apps" className="underline">
                      Connections
                    </Link>{" "}
                    to reply.
                  </p>
                ))}
              {!account.canModify && (
                <p className="kova-inbox-meta">
                  Read/unread and Trash changes require mailbox write permission in Connections.
                </p>
              )}
            </>
          )}
        </article>
      ) : (
        <>
          <div className="kova-inbox-toolbar">
            <label className="kova-inbox-search">
              <Search aria-hidden="true" />
              <input
                aria-label="Search loaded messages"
                placeholder="Search mail"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh inbox"
              disabled={busy || loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
          {loading ? (
            <p role="status" className="kova-inbox-empty">
              Loading messages…
            </p>
          ) : (
            <>
              <ul className="kova-inbox-list">
                {visible.map((row) => {
                  const isMail = row.kind === "mail";
                  const id = isMail ? row.message.id : row.notice.id;
                  const sender = isMail ? row.message.from : "KovaGPT";
                  const subject = isMail ? row.message.subject : row.notice.title;
                  const preview = isMail ? row.message.preview : row.notice.preview;
                  return (
                    <li key={`${row.kind}:${id}`} data-unread={unread(row)}>
                      <button
                        type="button"
                        className="kova-inbox-row"
                        onClick={() => open(row)}
                        disabled={busy}
                      >
                        <span className="kova-inbox-row-icon">
                          {isMail ? unread(row) ? <Mail /> : <Check /> : <Bell />}
                        </span>
                        <span className="kova-inbox-sender">{sender}</span>
                        <span className="kova-inbox-summary">
                          <span>{subject}</span>
                          {showPreview && preview && <small>{preview}</small>}
                        </span>
                        <time>{formatDate(date(row))}</time>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!visible.length && !error && (
                <p className="kova-inbox-empty">
                  {search
                    ? "No matching loaded messages."
                    : folder === "trash"
                      ? "Trash is empty."
                      : "Your inbox is empty."}
                </p>
              )}
              {next && (
                <Button variant="ghost" disabled={busy} onClick={loadMore}>
                  Load more messages
                </Button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
