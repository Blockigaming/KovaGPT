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
import { useState } from "react";

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
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[28px] border-border/70 p-7 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight">
            Build your Kova Enterprise workspace
          </DialogTitle>
          <DialogDescription>
            Tell us about your team, security requirements, and expected usage. Sales will reply
            with a tailored rollout and transparent annual quote.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Input
              className="h-11 rounded-xl"
              required
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              type="email"
              required
              className="h-11 rounded-xl"
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              required
              className="h-11 rounded-xl"
              placeholder="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
            <select
              required
              aria-label="Team size"
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
            >
              <option value="">Team size</option>
              <option value="2-49">2-49</option>
              <option value="50-249">50-249</option>
              <option value="250-999">250-999</option>
              <option value="1000+">1,000+</option>
            </select>
          </div>
          <Textarea
            required
            className="min-h-32 rounded-xl"
            placeholder="What are you looking for? Use cases, volume, integrations, etc."
            rows={5}
            value={needs}
            onChange={(e) => setNeeds(e.target.value)}
          />
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
