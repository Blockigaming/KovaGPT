"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    value={value}
    data-ui-reference="chatgpt.slider.track-as-meter"
    className={cn(
      "relative h-1 w-full overflow-hidden rounded-[2px] bg-[#dfdfdf] dark:bg-[#414141]",
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 rounded-[2px] bg-[#767676] transition-transform motion-reduce:transition-none dark:bg-[#8f8f8f]"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
