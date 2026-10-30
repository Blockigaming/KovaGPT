import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        data-slot="textarea"
        data-ui-reference="chatgpt.textarea.outline"
        className={cn(
          "font-[family-name:var(--font-ui)] flex min-h-24 w-full rounded-[8px] border border-input bg-transparent px-3 py-2 text-base leading-6 shadow-none transition-colors duration-150 hover:border-foreground/25 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-foreground/50 focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
