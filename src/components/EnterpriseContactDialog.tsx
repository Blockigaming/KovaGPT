import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";

const SALES_EMAIL = "sales@kovagpt.com";

export function EnterpriseContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [needs, setNeeds] = useState("");
  const [mailDraftOpened, setMailDraftOpened] = useState(false);

  useEffect(() => {
    if (!open) setMailDraftOpened(false);
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Company: ${company}`,
      `Team size: ${teamSize}`,
      "",
      "What they're looking for:",
      needs,
    ].join("\n");
    const href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
      "KovaGPT Enterprise inquiry",
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    setMailDraftOpened(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[28px] border-border/70 p-7 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight">
            Build your Kova Enterprise workspace
          </DialogTitle>
          <DialogDescription>
            Enter your details to open a draft in your email app. Nothing is sent until you review
            and send that email yourself.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="enterprise-name">Your name</Label>
              <Input
                id="enterprise-name"
                autoComplete="name"
                className="h-11 rounded-xl"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enterprise-email">Work email</Label>
              <Input
                id="enterprise-email"
                type="email"
                autoComplete="email"
                required
                className="h-11 rounded-xl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="enterprise-company">Company</Label>
              <Input
                id="enterprise-company"
                autoComplete="organization"
                required
                className="h-11 rounded-xl"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enterprise-team-size">Team size</Label>
              <select
                id="enterprise-team-size"
                required
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
              >
                <option value="">Select a range</option>
                <option value="2-49">2-49</option>
                <option value="50-249">50-249</option>
                <option value="250-999">250-999</option>
                <option value="1000+">1,000+</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="enterprise-needs">What are you looking for?</Label>
            <Textarea
              id="enterprise-needs"
              required
              className="min-h-32 rounded-xl"
              placeholder="Use cases, volume, integrations, and security needs"
              rows={5}
              value={needs}
              onChange={(e) => setNeeds(e.target.value)}
            />
          </div>
          {mailDraftOpened ? (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              Your email app should have opened a draft. Nothing has been sent by KovaGPT.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              className="rounded-full px-5"
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-full px-5" type="submit">
              Contact sales
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
