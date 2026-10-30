import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Settings } from "@/lib/settings-types";
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
  const [notice, setNotice] = useState("");
  const change = (patch: Partial<Settings>) => {
    setNotice("");
    if (patch.mode) applyThemeMode(patch.mode);
    onChange({ ...settings, ...patch });
  };
  const rows = [
    {
      key: "mode",
      label: "Theme",
      hint: "Choose how KovaGPT looks.",
      options: [
        ["dark", "Dark"],
        ["light", "Light"],
        ["system", "System"],
      ],
    },
    {
      key: "density",
      label: "Density",
      hint: "Space between navigation and list items.",
      options: [
        ["comfortable", "Comfortable"],
        ["compact", "Compact"],
      ],
    },
    {
      key: "readingSize",
      label: "Text size",
      hint: "The size of text in answers.",
      options: [
        ["16", "Default"],
        ["18", "Large"],
        ["20", "Extra large"],
      ],
    },
    {
      key: "readingWidth",
      label: "Reading width",
      hint: "The maximum width of answers.",
      options: [
        ["680", "Narrow"],
        ["760", "Default"],
        ["900", "Wide"],
      ],
    },
    {
      key: "motion",
      label: "Motion",
      hint: "Your device’s reduced-motion preference takes priority.",
      options: [
        ["full", "Full"],
        ["reduced", "Reduced"],
      ],
    },
  ] as const;
  return (
    <div className="kova-appearance-settings" data-ui-reference="chatgpt.settings.appearance">
      <div className="kova-preference-list">
        {rows.map(({ key, label, hint, options }) => (
          <div className="kova-preference-row" key={key}>
            <div>
              <label id={`appearance-${key}`} className="font-medium">
                {label}
              </label>
              <p>{hint}</p>
            </div>
            <Select
              value={String(values[key])}
              onValueChange={(value) => {
                if (key === "readingSize")
                  change({ readingSize: Number(value) as Settings["readingSize"] });
                else if (key === "readingWidth")
                  change({ readingWidth: Number(value) as Settings["readingWidth"] });
                else change({ [key]: value } as Partial<Settings>);
              }}
            >
              <SelectTrigger aria-labelledby={`appearance-${key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map(([value, title]) => (
                  <SelectItem key={value} value={value}>
                    {title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <section className="kova-appearance-preview" aria-label="Reading preview">
        <p className="text-xs text-muted-foreground mb-3">Preview</p>
        <p
          style={{ fontSize: values.readingSize, maxWidth: values.readingWidth, lineHeight: 1.65 }}
        >
          A clear answer starts with the useful details. Your reading preferences apply to answers
          throughout KovaGPT.
        </p>
      </section>
      <div className="flex flex-wrap items-center gap-3 mt-5">
        <Button
          variant="ghost"
          onClick={() => {
            const reset = resetAppearance(settings);
            applyThemeMode(reset.mode);
            onChange(reset);
            setNotice("Appearance reset to defaults.");
          }}
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4 mr-2" />
          Reset appearance
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      </div>
      <p className="text-xs text-muted-foreground mt-5">
        Saved automatically for this account on this device.
      </p>
    </div>
  );
}
