import { useEffect, useRef, useState } from "react";
import { projectAppearance, type ProjectAppearance } from "@/lib/project-appearance";
import { Button } from "@/components/ui/button";

export function ProjectAppearanceEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ProjectAppearance;
  onChange(value: ProjectAppearance): void;
  disabled?: boolean;
}) {
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const current = useRef({ value, onChange, disabled });
  current.current = { value, onChange, disabled };
  async function upload(file: File | undefined, field: "logo" | "cover") {
    if (!file || disabled) return;
    const attempt = ++generation.current;
    setError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5_000_000)
        throw new Error("Choose a PNG, JPEG, or WebP under 5 MB.");
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(
        1,
        (field === "logo" ? 192 : 960) / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        throw new Error("This image could not be prepared.");
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const asset = canvas.toDataURL("image/webp", 0.75);
      if (asset.length > 180_000) throw new Error("Choose a simpler or smaller image.");
      if (attempt !== generation.current || current.current.disabled) return;
      const next = { ...current.current.value, [field]: asset };
      current.current.onChange(projectAppearance(next));
    } catch (reason) {
      if (attempt === generation.current)
        setError(reason instanceof Error ? reason.message : "Image could not be loaded.");
    }
  }
  return (
    <fieldset
      data-project-appearance
      className="space-y-3 rounded-2xl border border-border p-4"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">Project appearance</legend>
      <div className="flex flex-wrap gap-2" aria-label="Choose project emoji">
        {["📁", "🚀", "💡", "🎨", "💻", "📚", "🌎", "⚡"].map((emoji) => (
          <Button
            key={emoji}
            type="button"
            variant="outline"
            aria-label={`Use ${emoji}`}
            aria-pressed={value.emoji === emoji && !value.logo}
            onClick={() => {
              generation.current++;
              onChange({ ...value, emoji, logo: undefined });
            }}
          >
            {emoji}
          </Button>
        ))}
      </div>
      <label className="block text-sm">
        Custom emoji
        <input
          aria-label="Custom project emoji"
          maxLength={16}
          value={value.emoji ?? ""}
          className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3"
          onChange={(event) => {
            generation.current++;
            onChange({ ...value, emoji: event.target.value, logo: undefined });
          }}
        />
      </label>
      <label className="block text-sm">
        Upload logo
        <input
          className="mt-2 block w-full text-sm"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void upload(event.target.files?.[0], "logo")}
        />
      </label>
      {value.logo && (
        <img
          src={value.logo}
          alt="Project logo preview"
          className="h-12 w-12 rounded-xl object-cover"
        />
      )}
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        Background color
        <input
          aria-label="Project background color"
          type="color"
          value={value.background ?? "#303030"}
          onChange={(event) => onChange({ ...value, background: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        Upload background
        <input
          className="mt-2 block w-full text-sm"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void upload(event.target.files?.[0], "cover")}
        />
      </label>
      {value.cover && (
        <img
          src={value.cover}
          alt="Project background preview"
          className="h-24 w-full rounded-xl object-cover"
        />
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          generation.current++;
          onChange({});
        }}
      >
        Reset appearance
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
export function ProjectIcon({ appearance }: { appearance?: ProjectAppearance }) {
  const value = projectAppearance(appearance);
  return value.logo ? (
    <img src={value.logo} alt="" className="h-10 w-10 rounded-xl object-cover" />
  ) : (
    <span className="text-2xl" aria-hidden="true">
      {value.emoji || "📁"}
    </span>
  );
}
