import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { readAppleHealthExport, type AppleHealthSource } from "@/health/apple-health-export.mjs";
import {
  MAX_APPLE_HEALTH_REPORT_BYTES,
  parseAppleHealthReport,
} from "@/health/apple-health-report.mjs";

export function AppleHealthReport({ ownerId }: { ownerId: string | null }) {
  const [result, setResult] = useState<{ sources: AppleHealthSource[]; export: boolean } | null>(
    null,
  );
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController>(null);
  const days = result?.sources[selected]?.days ?? [];

  useEffect(() => {
    const clearOnPageHide = () => {
      pending.current?.abort();
      setResult(null);
      setSelected(0);
      setStatus("");
    };
    window.addEventListener("pagehide", clearOnPageHide);
    return () => {
      pending.current?.abort();
      window.removeEventListener("pagehide", clearOnPageHide);
    };
  }, []);

  const clear = () => {
    pending.current?.abort();
    setResult(null);
    setSelected(0);
    setStatus("");
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !ownerId) return;
    clear();
    const controller = new AbortController();
    pending.current = controller;
    setStatus("Reading Apple Health file…");
    try {
      const isExport = /\.(zip|xml)$/i.test(file.name);
      if (!isExport && file.size > MAX_APPLE_HEALTH_REPORT_BYTES) throw new Error();
      const sources = isExport
        ? await readAppleHealthExport(file, controller.signal)
        : [{ name: "Apple Health", days: parseAppleHealthReport(await file.text()) }];
      if (controller.signal.aborted) return;
      if (!sources.length) {
        setStatus("This export contains no step samples for its last seven days.");
        return;
      }
      setResult({ sources, export: isExport });
      setStatus("");
    } catch {
      if (!controller.signal.aborted) {
        setStatus(
          "Could not read the file. Choose an Apple Health export ZIP, export.xml or .kovahealth report.",
        );
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };

  return (
    <section
      className="!mt-3 space-y-3 rounded-3xl bg-muted/30 p-4 sm:p-5"
      aria-labelledby="apple-health-title"
    >
      <h3 id="apple-health-title" className="font-medium">
        Apple Health
      </h3>
      <p className="text-sm text-muted-foreground">
        On iPhone, open Health, tap your profile, choose Export All Health Data, then save to Files.
        Open the ZIP here to see seven days of steps. Your file stays on your device.
      </p>
      {ownerId && (
        <>
          <input
            type="file"
            accept=".zip,.xml,.kovahealth,application/zip,application/xml,text/xml"
            aria-label="Apple Health report file"
            className="hidden"
            ref={fileInput}
            onChange={(event) => void readFile(event)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => fileInput.current?.click()}
            >
              Open Apple Health report
            </Button>
            {days.length > 0 && (
              <Button variant="ghost" onClick={clear}>
                Clear report
              </Button>
            )}
          </div>
        </>
      )}
      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {result?.export && (
        <div className="space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Step source
            <select
              className="min-w-0 max-w-full rounded-lg border border-border bg-background p-2"
              value={selected}
              onChange={(event) => setSelected(Number(event.currentTarget.value))}
            >
              {result.sources.map(({ name }, index) => (
                <option value={index} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            Totals are shown for one source at a time because iPhone and Apple Watch can count the
            same steps.
          </p>
        </div>
      )}
      {days.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left font-medium">Daily steps from Apple Health</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1">
                Date
              </th>
              <th scope="col" className="py-1 text-right">
                Steps
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map(({ date, steps }) => (
              <tr key={date} className="border-t border-border">
                <td className="py-1.5">
                  <time dateTime={date}>{date}</time>
                </td>
                <td className="py-1.5 text-right tabular-nums">{steps.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
