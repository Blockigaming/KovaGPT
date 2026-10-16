import { useAcademyAccount } from "@/lib/use-academy-account";
import { useUser } from "@/components/auth/ClerkSafe";
import { useDeviceRecord } from "@/lib/use-device-record";
import { EMPTY_ACADEMY_PROGRESS, isAcademyProgress } from "@/lib/academy-progress.mjs";
import { ACADEMY_ACCOUNT_PERSISTENCE_ENABLED } from "@/lib/academy-state-policy.mjs";
import { DeviceRecoveryStatus } from "@/components/DeviceRecoveryStatus";
import type { PublicDetailPage } from "@/lib/public-detail-content";
export function AcademyPractice({ item }: { item: PublicDetailPage }) {
  const { isLoaded, user } = useUser();
  return (
    <AcademyPracticeSession
      key={JSON.stringify([isLoaded, user?.id, item.slug])}
      item={item}
      actor={isLoaded ? (user?.id ?? null) : undefined}
    />
  );
}
function AcademyPracticeSession({
  item,
  actor,
}: {
  item: PublicDetailPage;
  actor: string | null | undefined;
}) {
  const draft = useDeviceRecord(
    "kova-academy-progress",
    actor,
    item.slug,
    EMPTY_ACADEMY_PROGRESS,
    isAcademyProgress,
  );
  const account = useAcademyAccount(actor, item.slug, draft);
  if (!draft.loaded) return <p role="status">Loading practice notes…</p>;
  const points = item.sections[0]?.points ?? [];
  const exportNotes = () => {
    const body = `# ${item.title}\n\nPractice ${draft.value.completed ? "complete" : "in progress"}\n\n${points.map((p) => `- [${draft.value.checked.includes(p) ? "x" : " "}] ${p}`).join("\n")}\n\n## Working notes\n\n${draft.value.notes}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `kova-academy-${item.slug.replaceAll("/", "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="kova-adapted-controls mx-auto max-w-3xl space-y-4 px-4 pb-12"
      aria-labelledby="academy-practice-title"
    >
      <h2 id="academy-practice-title" className="text-2xl font-semibold">
        Your practice
      </h2>
      <p className="text-sm text-muted-foreground">
        These are practice outlines, not certification. Device recovery is separate from account
        storage. Use Export current notes to keep a separate copy.
      </p>
      <fieldset className="space-y-2">
        <legend className="font-medium">Practice checklist</legend>
        {points.map((point) => (
          <label key={point} className="flex min-h-11 items-start gap-3 py-2">
            <input
              type="checkbox"
              checked={draft.value.checked.includes(point)}
              onChange={(event) =>
                draft.setValue({
                  ...draft.value,
                  checked: event.target.checked
                    ? [...draft.value.checked, point]
                    : draft.value.checked.filter((p) => p !== point),
                })
              }
            />
            <span>{point}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="academy-notes" className="block font-medium">
        Working notes
      </label>
      <textarea
        id="academy-notes"
        maxLength={20000}
        rows={8}
        value={draft.value.notes}
        onChange={(event) => draft.setValue({ ...draft.value, notes: event.target.value })}
        className="w-full rounded-xl border bg-background p-3 text-base"
      />
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={draft.value.completed}
          onChange={(event) => draft.setValue({ ...draft.value, completed: event.target.checked })}
        />
        Mark this practice complete (uncheck to reopen)
      </label>
      <button type="button" onClick={exportNotes} className="min-h-11 rounded-xl border px-4">
        Export current notes
      </button>
      <DeviceRecoveryStatus {...draft} />
      {!ACADEMY_ACCOUNT_PERSISTENCE_ENABLED ? (
        <p role="status" className="text-sm">
          Academy account saving is paused for this launch. Current notes are device-only, not saved
          to your account.
        </p>
      ) : actor ? (
        <div className="space-y-2" aria-label="Account learning state">
          <p role="status">
            {account.pending
              ? "Saving to account…"
              : account.loaded
                ? account.matches
                  ? "Current notes match the account version."
                  : "Current device draft differs from the account version."
                : "Account version not loaded."}
          </p>
          {account.error && <p role="alert">{account.error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!account.loaded || account.pending}
              onClick={() => void account.saveCurrent().catch(() => {})}
              className="min-h-11 rounded-xl border px-4"
            >
              Save current notes to account
            </button>
            <button
              type="button"
              disabled={account.pending}
              onClick={account.refresh}
              className="min-h-11 rounded-xl border px-4"
            >
              Refresh account version
            </button>
            <button
              type="button"
              disabled={!account.loaded || account.pending}
              onClick={() => {
                if (
                  window.confirm(
                    "Replace the device draft with the account version? Export current notes first if needed.",
                  )
                )
                  account.useAccount();
              }}
              className="min-h-11 rounded-xl border px-4"
            >
              Use account version
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm">
          Sign in to save notes to an account. Guest recovery stays on this device.
        </p>
      )}
    </section>
  );
}
