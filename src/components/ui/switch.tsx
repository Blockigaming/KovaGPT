import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    data-slot="switch"
    data-ui-reference="chatgpt.switch"
    className={cn(
      "peer group/switch inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
      className,
    )}
    {...props}
    ref={ref}
  >
    {/* Keep the painted track independent of the full-size interactive target. */}
    <span
      data-slot="switch-track"
      aria-hidden="true"
      className="pointer-events-none relative inline-flex h-[19px] w-8 shrink-0 items-center rounded-full bg-[#dfdfdf] transition-colors duration-250 dark:bg-[#414141] group-data-[state=checked]/switch:bg-[#181818] dark:group-data-[state=checked]/switch:bg-[#0285ff]"
    >
      <SwitchPrimitives.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute left-[3px] top-[3px] block h-[13px] w-[13px] shrink-0 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/20%)] ring-0 transition-transform duration-250 data-[state=checked]:translate-x-[13px] data-[state=unchecked]:translate-x-0"
      />
    </span>
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
