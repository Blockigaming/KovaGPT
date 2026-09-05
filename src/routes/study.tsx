import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { StudyPanel } from "@/components/StudyPanel";
import { useUser } from "@/components/auth/ClerkSafe";
export const Route = createFileRoute("/study")({
  component: StudyPage,
  head: () => ({ meta: [{ title: "Study | KovaGPT" }, { name: "robots", content: "noindex" }] }),
});
function StudyPage() {
  const { user, isLoaded } = useUser();
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl overflow-y-auto p-4 md:p-8">
        <h1 className="mb-5 text-2xl font-semibold">Study</h1>
        {isLoaded ? (
          <StudyPanel key={user?.id ?? "guest"} ownerId={user?.id ?? null} />
        ) : (
          <p role="status">Loading account…</p>
        )}
      </main>
    </AppShell>
  );
}
