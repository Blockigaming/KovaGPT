import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Users, X, UserPlus } from "lucide-react";
import { toast } from "sonner";

type Member = { id: string; email: string; addedAt: number };

function storageKey(chatId: string) {
  return `kova-chat-members:${chatId}`;
}

function loadMembers(chatId: string): Member[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(chatId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveMembers(chatId: string, list: Member[]) {
  try {
    localStorage.setItem(storageKey(chatId), JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function AddMembersDialog({
  open,
  chatId,
  onOpenChange,
}: {
  open: boolean;
  chatId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (open && chatId) setMembers(loadMembers(chatId));
  }, [open, chatId]);

  const add = () => {
    if (!chatId) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (members.some((m) => m.email === trimmed)) {
      toast.message("That person is already on this chat.");
      return;
    }
    const next: Member[] = [
      ...members,
      { id: Math.random().toString(36).slice(2), email: trimmed, addedAt: Date.now() },
    ];
    setMembers(next);
    saveMembers(chatId, next);
    setEmail("");
    toast.success(`Invited ${trimmed}`);
  };

  const remove = (id: string) => {
    if (!chatId) return;
    const next = members.filter((m) => m.id !== id);
    setMembers(next);
    saveMembers(chatId, next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" /> Add members
          </DialogTitle>
          <DialogDescription>
            Invite people by email to collaborate on this chat. They will see new messages when they open the chat.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" onClick={add}>
            <UserPlus className="w-4 h-4 mr-1.5" /> Add
          </Button>
        </div>

        <div className="mt-2">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet. Add someone above.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="truncate">{m.email}</span>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    className="p-1 rounded hover:bg-accent transition"
                    aria-label={`Remove ${m.email}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
