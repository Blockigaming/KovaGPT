import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

/** Native inputs with real browser activation and form participation. */
export function NativeControlsFixture() {
  const [values, setValues] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const initializeMixed = useCallback((input: HTMLInputElement | null) => {
    if (input) input.indeterminate = true;
  }, []);
  return (
    <main className="fixture-page kova-core-page">
      <h1 className="mb-4 text-xl font-semibold">Native form controls</h1>
      <form
        data-testid="native-form"
        className="space-y-5"
        onChange={(event) => {
          const input = event.target as HTMLInputElement;
          setChanges((previous) => [...previous, `${input.name}:${input.value}:${input.checked}`]);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          setValues(JSON.stringify(Array.from(new FormData(event.currentTarget).entries())));
        }}
      >
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">Files</legend>
          <label className="kova-library-select flex items-center gap-3 py-1.5">
            <input className="kova-native-check" type="checkbox" name="include" value="notes" />
            Include notes
          </label>
          <label className="flex items-center gap-3 py-1.5">
            <input type="checkbox" name="painted" value="checked" defaultChecked />
            Checked example
          </label>
          <label className="flex items-center gap-3 py-1.5">
            <input type="checkbox" name="mixed" value="included" ref={initializeMixed} />
            Mixed example
          </label>
          <label className="flex items-center gap-3 py-1.5">
            <input
              type="checkbox"
              name="disabled-checkbox"
              value="unavailable"
              defaultChecked
              disabled
            />
            Disabled example
          </label>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">View</legend>
          <label className="flex items-center gap-3 py-1.5">
            <input type="radio" name="view" value="list" defaultChecked /> List
          </label>
          <label className="flex items-center gap-3 py-1.5">
            <input type="radio" name="view" value="grid" /> Grid
          </label>
          <label className="flex items-center gap-3 py-1.5">
            <input type="radio" name="view" value="disabled" disabled /> Disabled view
          </label>
        </fieldset>
        <Button type="submit">Inspect form values</Button>
        <output data-testid="native-values">{values}</output>
        <output data-testid="native-changes">{JSON.stringify(changes)}</output>
      </form>
    </main>
  );
}
