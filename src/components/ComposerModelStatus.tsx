import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Model availability is not inferred from a paid tier or the legacy effort field. */
export function ComposerModelStatus({ visible }: { visible: boolean }) {
  const titleId = useId();
  if (!visible) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kova-composer-model-status"
          aria-label="Model availability"
        >
          Model
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)]"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="text-sm font-semibold">
          Model availability
        </h2>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">
          Model selection isn’t available in this session. The current serving model isn’t
          confirmed.
        </p>
      </PopoverContent>
    </Popover>
  );
}
