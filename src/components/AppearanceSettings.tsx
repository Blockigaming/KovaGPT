import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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
  const [interfaceSizeDraft, setInterfaceSizeDraft] = useState<number | null>(null);
  const [navigationWidthDraft, setNavigationWidthDraft] = useState<number | null>(null);
  const change = (patch: Partial<Settings>) => {
    setNotice("");
    if (patch.mode) {
      applyThemeMode(patch.mode);
      publishKovaNotice({ id: "theme_changed", title: "Appearance changed", confirmed: true });
    }
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
      <section className="kova-appearance-size" aria-labelledby="appearance-layout-heading">
        <h3 id="appearance-layout-heading">Layout size</h3>
        <div className="kova-preference-row kova-preference-slider">
          <div>Interface size</div>
          <output>{interfaceSizeDraft ?? values.interfaceSize}%</output>
          <Slider
            thumbProps={{
              "aria-label": "Interface size",
              "aria-valuetext": `${interfaceSizeDraft ?? values.interfaceSize}%`,
            }}
            min={85}
            max={125}
            step={1}
            value={[interfaceSizeDraft ?? values.interfaceSize]}
            onValueChange={([value]) => setInterfaceSizeDraft(value)}
            onValueCommit={([value]) => {
              setInterfaceSizeDraft(null);
              change({ interfaceSize: value });
            }}
          />
          <div className="kova-preference-slider-range" aria-hidden="true">
            <span>85%</span>
            <span>125%</span>
          </div>
        </div>
        <div className="kova-preference-row kova-preference-slider kova-desktop-navigation-preference">
          <div>Settings sidebar width</div>
          <output>{navigationWidthDraft ?? values.settingsNavigationWidth}px</output>
          <Slider
            thumbProps={{
              "aria-label": "Settings sidebar width",
              "aria-valuetext": `${navigationWidthDraft ?? values.settingsNavigationWidth} pixels`,
            }}
            min={200}
            max={440}
            value={[navigationWidthDraft ?? values.settingsNavigationWidth]}
            onValueChange={([value]) => setNavigationWidthDraft(value)}
            onValueCommit={([value]) => {
              setNavigationWidthDraft(null);
              change({ settingsNavigationWidth: value });
            }}
          />
          <div className="kova-preference-slider-range" aria-hidden="true">
            <span>200 px</span>
            <span>440 px</span>
          </div>
        </div>
      </section>
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
      <div className="kova-preference-list">
        <label className="kova-preference-row">
          Interface font
          <select
            value={values.interfaceFont}
            onChange={(event) =>
              change({ interfaceFont: event.target.value as Settings["interfaceFont"] })
            }
          >
            <option value="system">System</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </label>
        {[
          ["background", "Background"],
          ["foreground", "Text"],
          ["card", "Panels"],
          ["border", "Borders"],
          ["sidebar", "Sidebar"],
          ["muted", "Muted surfaces"],
          ["muted-foreground", "Secondary text"],
          ["accent", "Selected items"],
        ].map(([key, label]) => (
          <label className="kova-preference-row" key={key}>
            {label}
            <input
              type="color"
              value={values.interfaceColors[key] || "#808080"}
              onChange={(event) =>
                change({
                  interfaceColors: { ...values.interfaceColors, [key]: event.target.value },
                })
              }
            />
          </label>
        ))}
        <label className="kova-preference-row">
          Accent color
          <input
            type="color"
            value={values.interfaceAccent || "#808080"}
            onChange={(event) => change({ interfaceAccent: event.target.value })}
          />
        </label>
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
            setInterfaceSizeDraft(null);
            setNavigationWidthDraft(null);
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
