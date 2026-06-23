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

const SALES_EMAIL = "zacharylblock@gmail.com";

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
      "NovaGPT Enterprise inquiry",
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Talk to us about Enterprise</DialogTitle>
          <DialogDescription>
            Tell us what you're looking for. Estimated pricing is $500 - $5,000 / month,
            but the final price depends on your needs. Someone will get back to you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              type="email"
              required
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
            <Input
              placeholder="Team size"
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
            />
          </div>
          <Textarea
            required
            placeholder="What are you looking for? Use cases, volume, integrations, etc."
            rows={5}
            value={needs}
            onChange={(e) => setNeeds(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Send inquiry</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
