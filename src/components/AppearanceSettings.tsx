import { useState } from "react";
import { Check, FileText, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Settings } from "@/components/SettingsDialog";
import { appearanceValues, resetAppearance } from "@/lib/appearance-preferences.mjs";
import { applyThemeMode } from "@/lib/theme";
import "@/styles/appearance-settings.css";

export function AppearanceSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const values = appearanceValues(settings);
  const [previewSelected, setPreviewSelected] = useState(false);
  const [resetNotice, setResetNotice] = useState("");
  const change = (patch: Partial<Settings>) => {
    setResetNotice("");
    if (patch.mode) applyThemeMode(patch.mode);
    onChange({ ...settings, ...patch });
  };
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Changes apply immediately and save on this device for this account. Cross-device sync is
        unavailable.
      </p>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Theme</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["dark", "Dark", "Default"],
              ["light", "Light", "Light surfaces"],
              ["system", "Match device settings", "Follows your device"],
            ] as const
          ).map(([mode, title, hint]) => (
            <label
              key={mode}
              className="kova-appearance-theme-choice"
              data-selected={values.mode === mode}
            >
              <input
                type="radio"
                name="settings-theme"
                value={mode}
                checked={values.mode === mode}
                onChange={() => change({ mode })}
              />
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="kova-settings-reference-group">
        <div className="kova-settings-reference-row flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="text-sm font-medium">Accent</span>
          <span className="text-sm text-muted-foreground">Original palette</span>
        </div>
        <p className="pb-3 text-xs text-muted-foreground">
          The current color palette is preserved. Accent presets are unavailable.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          Density
          <select
            className="kova-native-select"
            value={values.density}
            onChange={(event) => change({ density: event.target.value as Settings["density"] })}
          >
            <option value="comfortable">Comfortable (default)</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          Reading size
          <select
            className="kova-native-select"
            value={values.readingSize}
            onChange={(event) =>
              change({ readingSize: Number(event.target.value) as Settings["readingSize"] })
            }
          >
            {[16, 18, 20].map((size) => (
              <option key={size} value={size}>
                {size}px{size === 16 ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          Reading width
          <select
            className="kova-native-select"
            value={values.readingWidth}
            onChange={(event) =>
              change({ readingWidth: Number(event.target.value) as Settings["readingWidth"] })
            }
          >
            {[680, 760, 900].map((width) => (
              <option key={width} value={width}>
                {width}px{width === 760 ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          Motion
          <select
            className="kova-native-select"
            value={values.motion}
            onChange={(event) => change({ motion: event.target.value as Settings["motion"] })}
          >
            <option value="full">Full (default)</option>
            <option value="reduced">Reduced</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Reading width is capped to the available space. Your device’s reduced-motion setting always
        takes priority.
      </p>
      <section
        className="kova-appearance-preview space-y-4"
        aria-labelledby="appearance-preview-heading"
        data-motion={values.motion}
        data-density={values.density}
        data-selected={previewSelected}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="appearance-preview-heading" className="text-sm font-semibold">
            Live appearance preview
          </h3>
          <span className="text-xs text-muted-foreground">
            {values.readingSize}px · {values.readingWidth}px maximum
          </span>
        </div>
        <div className="kova-appearance-preview-reading" style={{ maxWidth: values.readingWidth }}>
          <div
            className="kova-appearance-preview-nav"
            style={{ minHeight: values.density === "compact" ? 48 : 56 }}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            <span>Project notes</span>
            <span className="ml-auto text-xs text-muted-foreground">Example</span>
          </div>
          <p className="kova-appearance-preview-prose" style={{ fontSize: values.readingSize }}>
            A clear answer starts with the useful details. Your reading preferences adjust this
            paragraph while controls and headings keep their familiar size.
          </p>
          <div className="kova-appearance-preview-box">
            <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">Planning notes</p>
              <p className="text-xs text-muted-foreground">An example content box</p>
            </div>
          </div>
          <Button
            type="button"
            aria-pressed={previewSelected}
            onClick={() => setPreviewSelected((selected) => !selected)}
          >
            {previewSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}Preview
            button
          </Button>
          <p className="min-h-5 text-xs text-muted-foreground" role="status">
            {previewSelected
              ? "Preview button selected."
              : "Try the button to preview its selected state."}
          </p>
        </div>
      </section>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const next = resetAppearance(settings);
            applyThemeMode(next.mode);
            onChange(next);
            setResetNotice(
              "Appearance defaults restored. Response preferences and data are unchanged.",
            );
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset appearance
        </Button>
        <p className="text-xs text-muted-foreground">
          Restores Dark theme, Comfortable density, 16px reading size, 760px reading width, and Full
          motion.
        </p>
        <p className="text-xs text-muted-foreground" role="status">
          {resetNotice}
        </p>
      </div>
    </div>
  );
}
