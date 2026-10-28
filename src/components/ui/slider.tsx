import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    thumbProps?: Pick<
      React.AriaAttributes,
      "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-valuetext"
    >;
  }
>(({ className, thumbProps, ...props }, ref) => (
  <SliderPrimitive.Root
    data-slot="slider"
    ref={ref}
    className={cn(
      "relative flex min-h-11 w-full touch-none select-none items-center data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track
      data-slot="slider-track"
      className="relative mx-3 h-1 w-full grow overflow-hidden rounded-full bg-input"
    >
      <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
      {...thumbProps}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none h-5 w-5 rounded-full border-2 border-background bg-primary shadow-sm"
      />
    </SliderPrimitive.Thumb>
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
