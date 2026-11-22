import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        data-slot="input"
        data-ui-reference="chatgpt.input.outline"
        type={type}
        className={cn(
          "font-[family-name:var(--font-ui)] flex h-9 w-full rounded-[8px] border border-input bg-transparent px-3 py-0 text-base leading-5 shadow-none transition-colors duration-150 hover:border-foreground/25 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-foreground/50 focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm [@media(pointer:coarse)]:min-h-11",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
