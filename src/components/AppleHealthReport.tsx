import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  MAX_APPLE_HEALTH_REPORT_BYTES,
  parseAppleHealthReport,
  type AppleHealthDay,
} from "@/health/apple-health-report.mjs";

export function AppleHealthReport({ ownerId }: { ownerId: string | null }) {
  const [days, setDays] = useState<AppleHealthDay[]>([]);
  const [error, setError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const readId = useRef(0);

  useEffect(() => {
    const clearOnPageHide = () => {
      readId.current += 1;
      setDays([]);
      setError(false);
    };
    window.addEventListener("pagehide", clearOnPageHide);
    return () => {
      readId.current += 1;
      window.removeEventListener("pagehide", clearOnPageHide);
    };
  }, []);

  const clear = () => {
    readId.current += 1;
    setDays([]);
    setError(false);
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !ownerId) return;
    clear();
    const id = readId.current;
    try {
      if (file.size > MAX_APPLE_HEALTH_REPORT_BYTES) throw new Error();
      const report = parseAppleHealthReport(await file.text());
      if (id === readId.current) setDays(report);
    } catch {
      if (id === readId.current) setError(true);
    }
  };

  return (
    <section
      className="!mt-3 space-y-3 rounded-3xl bg-muted/30 p-4 sm:p-5"
      aria-labelledby="apple-health-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="apple-health-title" className="font-medium">
          Apple Health
        </h3>
        <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">
          iPhone app required
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        With the KovaGPT Health iPhone app, you can open a seven-day step report here. The report
        stays in this tab until you clear it or leave the page.
      </p>
      {ownerId && (
        <>
          <input
            type="file"
            accept=".kovahealth"
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
      {error && (
        <p role="status" className="text-sm text-muted-foreground">
          Choose a .kovahealth report made by the KovaGPT Health iPhone app.
        </p>
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
