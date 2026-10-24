import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, MoreHorizontal, Plus, Send, Square, Trash2 } from "lucide-react";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Textarea } from "../../src/components/ui/textarea";
import { Checkbox } from "../../src/components/ui/checkbox";
import { Switch } from "../../src/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "../../src/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../src/components/ui/tabs";
import { Calendar } from "../../src/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../src/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../src/components/ui/dialog";
import { ResponseContentBox, ResponseMarkdown } from "../../src/components/ResponseMarkdown";
import type { DateRange } from "react-day-picker";

export const CONTROL_SHEET_WIDTHS = [320, 390, 768, 1024, 1440] as const;
const variants = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const sampleCode = `const reviewOnly = true;\nconst filename = "${"long-file-name-".repeat(12)}";\n`;

/** Same-origin document means media queries and Radix portals use the selected
 * viewport. Both documents load the app's compiled source stylesheet. */
export function ControlSheet() {
  const [width, setWidth] = useState<number>(390);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const frame = useRef<HTMLIFrameElement>(null);
  const isFrame = new URLSearchParams(window.location.search).has("controlSheetFrame");
  const sampleUrl = `${window.location.pathname}?controlSheetFrame=1`;
  const applyFrameTheme = () => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!root) return;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  };
  useEffect(applyFrameTheme, [theme]);
  if (isFrame) return <ControlSamples />;
  return (
    <section className="space-y-4" aria-label="Shared control sheet">
      <h1 className="text-2xl font-semibold">Shared control sheet</h1>
      <p className="text-sm text-muted-foreground">
        Actual application primitives and output components. All changes stay in this sample. Copy
        uses a simulated local writer; Download creates only the labeled sample file. Widths below
        are CSS viewports, not physical-device certification.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Control sheet viewport width">
        {CONTROL_SHEET_WIDTHS.map((value) => (
          <Button
            key={value}
            variant={width === value ? "default" : "outline"}
            aria-pressed={width === value}
            onClick={() => setWidth(value)}
          >
            {value}px
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Control sheet theme">
        {(["light", "dark"] as const).map((value) => (
          <Button
            key={value}
            variant={theme === value ? "default" : "outline"}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            {value} theme
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Tab through controls to inspect focus. Hover and press to inspect pointer states. Menus and
        nested dialogs remain interactive.
      </p>
      <a href={sampleUrl} target="_blank" rel="noopener" className="inline-block text-sm underline">
        Open control sample in a new tab
      </a>
      <p className="text-sm text-muted-foreground">
        The new tab starts in dark theme at full browser width, with a separate local sample.
      </p>
      <div className="max-w-full overflow-x-auto border rounded-[var(--kova-radius-output)]">
        <iframe
          ref={frame}
          title={`Actual controls at ${width}px in ${theme} theme`}
          src={sampleUrl}
          onLoad={applyFrameTheme}
          style={{ width, height: 1100, border: 0, display: "block", maxWidth: "none" }}
        />
      </div>
    </section>
  );
}

function ControlSamples() {
  const [count, setCount] = useState(0);
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [rejectCopy, setRejectCopy] = useState(false);
  const [status, setStatus] = useState("No sample action yet.");
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 9, 12),
    to: new Date(2026, 9, 16),
  });
  const action = () => {
    setCount((value) => value + 1);
    setStatus("Local sample action only.");
  };
  const writer = async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (rejectCopy) throw new Error("Simulated sample copy failure");
    setStatus("Simulated copy completed; system clipboard unchanged.");
  };
  return (
    <main
      className="h-dvh overflow-y-auto bg-background p-4 text-foreground space-y-6"
      data-control-sheet-samples
    >
      <header>
        <h1 className="text-xl font-semibold">Checkpoint 1b controls</h1>
        <p className="text-sm text-muted-foreground">
          Local samples. No account, provider or payment calls.
        </p>
        <p role="status" className="mt-2 text-sm">
          {status} {count > 0 && `Actions: ${count}`}
        </p>
      </header>
      <section className="space-y-3" aria-label="Button variants and states">
        <h2 className="text-lg font-semibold">Buttons: 44px actions and 48px submit</h2>
        {variants.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm">{variant}</span>
            <Button variant={variant} onClick={action}>
              <Plus aria-hidden />
              Action
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} disabled aria-busy="true">
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              Loading
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={action}>
            Small label, 44px target
          </Button>
          <Button size="lg" onClick={action}>
            Large label, 44px target
          </Button>
          <Button size="icon" aria-label="Copy sample action" onClick={action}>
            <Copy />
          </Button>
          <Button size="icon" aria-label="Send sample action" onClick={action}>
            <Send />
          </Button>
          <Button size="icon" aria-label="Stop sample action" onClick={action}>
            <Square />
          </Button>
          <Button size="icon" disabled aria-label="Disabled sample action">
            <Plus />
          </Button>
        </div>
        <Button size="prominent" onClick={action}>
          Prominent full-width submission
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal"
          onClick={action}
        >
          Long translated-style action label that wraps without covering its neighboring icon
          <Check aria-hidden />
        </Button>
      </section>
      <section className="space-y-3" aria-label="Native and link actions">
        <h2 className="text-lg font-semibold">Native and link actions</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 border px-4" onClick={action}>
            Native action
          </button>
          <a
            href="#sample-only"
            className="kova-button inline-flex min-h-11 items-center border px-4"
            onClick={(event) => {
              event.preventDefault();
              action();
            }}
          >
            Marked action link
          </a>
          <a
            href="#sample-only"
            className="kova-billing-plan-action inline-flex min-h-11 items-center border px-4"
            onClick={(event) => {
              event.preventDefault();
              action();
            }}
          >
            Billing action link
          </a>
        </div>
      </section>
      <section className="space-y-3" aria-label="Fields and semantic exceptions">
        <h2 className="text-lg font-semibold">Fields and widget exceptions</h2>
        <label className="block space-y-2">
          <span>Project title</span>
          <Input defaultValue="A long project title for wrapping and focus review" />
        </label>
        <label className="block space-y-2">
          <span>Disabled field</span>
          <Input disabled value="Unavailable sample" readOnly />
        </label>
        <label className="block space-y-2">
          <span>Instructions</span>
          <Textarea
            defaultValue={
              "An editable multiline sample.\nThe draft stays here while menus and dialogs open."
            }
          />
        </label>
        <label className="block space-y-2">
          <span>Native selection</span>
          <select className="h-11 w-full border bg-background px-4" defaultValue="one">
            <option value="one">First local option</option>
            <option value="two">Second local option</option>
          </select>
        </label>
        <Select defaultValue="one">
          <SelectTrigger aria-label="Shared select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">Shared menu option</SelectItem>
            <SelectItem value="two">Second option with a longer label</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex min-h-11 items-center gap-3">
          <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} />
          Local checkbox
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          Local switch
        </label>
        <RadioGroup defaultValue="one" aria-label="Local radio selection">
          <label className="flex min-h-11 items-center gap-3">
            <RadioGroupItem value="one" />
            One
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <RadioGroupItem value="two" />
            Two
          </label>
        </RadioGroup>
        <Tabs defaultValue="first">
          <TabsList>
            <TabsTrigger value="first">First tab</TabsTrigger>
            <TabsTrigger value="second">Second tab</TabsTrigger>
          </TabsList>
          <TabsContent value="first">Tabs keep their own geometry.</TabsContent>
          <TabsContent value="second">Second local panel.</TabsContent>
        </Tabs>
        <div className="max-w-full overflow-x-auto">
          <Calendar
            mode="range"
            month={new Date(2026, 9, 1)}
            selected={range}
            onSelect={setRange}
          />
        </div>
      </section>
      <section className="space-y-3" aria-label="Menus and dialogs">
        <h2 className="text-lg font-semibold">Floating layers</h2>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <MoreHorizontal />
                Open menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={action}>Local menu action</DropdownMenuItem>
              <DropdownMenuItem disabled>Unavailable item</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={action}>
                <Trash2 className="text-destructive" />
                Remove sample
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Shared dialog</DialogTitle>
                <DialogDescription>
                  Focus and Escape use the real dialog primitive.
                </DialogDescription>
              </DialogHeader>
              <label className="space-y-2">
                <span>Draft retained while nested dialog opens</span>
                <Input defaultValue="Local draft" />
              </label>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="secondary">Open nested dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Nested dialog</DialogTitle>
                    <DialogDescription>
                      Escape closes this layer and restores its trigger.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button>Close nested dialog</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Close dialog</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </section>
      <section className="space-y-3" aria-label="Semantic surfaces">
        <h2 className="text-lg font-semibold">Whole surfaces keep semantic corners</h2>
        <button
          data-kova-button-shape="preserve"
          className="block w-full rounded-[var(--kova-radius-card)] border p-4 text-left"
          onClick={action}
        >
          <strong className="block font-semibold">Selectable card</strong>
          <span className="text-sm text-muted-foreground">Its entire surface remains 20px.</span>
        </button>
        <div className="rounded-[var(--kova-radius-message)] bg-muted p-4">
          User message sample with 20px corners.
        </div>
        <div className="kova-composer rounded-[var(--kova-radius-composer)] border p-4">
          <label htmlFor="sample-composer">Composer sample</label>
          <textarea
            id="sample-composer"
            className="kova-composer-input block w-full bg-transparent"
            defaultValue={"A multiline draft\nwith one outer surface"}
          />
        </div>
        <p className="font-normal">Plex 400 regular</p>
        <p className="font-medium">Plex 500 medium</p>
        <p className="font-semibold">Plex 600 semibold</p>
      </section>
      <section className="space-y-3" aria-label="Output actions and long content">
        <h2 className="text-lg font-semibold">Real output container and footer</h2>
        <label className="flex min-h-11 items-center gap-3">
          <Checkbox
            checked={rejectCopy}
            onCheckedChange={(value) => setRejectCopy(value === true)}
          />
          Simulate copy failure
        </label>
        <div className="prose-chat">
          <ResponseContentBox
            text={sampleCode}
            kind="code"
            label="JavaScript"
            filename="control-sheet-only-long-filename-for-phone-footer-review.js"
            writeClipboard={writer}
          >
            <pre tabIndex={0} aria-label="JavaScript code block">
              <code>{sampleCode}</code>
            </pre>
          </ResponseContentBox>
        </div>
        <div className="prose-chat">
          <ResponseMarkdown
            children={
              "| Project name | Description | Destination | Status |\n| --- | --- | --- | --- |\n| Long named sample | Text stays readable within its table | A local review-only destination | Awaiting review |"
            }
          />
        </div>
      </section>
    </main>
  );
}
