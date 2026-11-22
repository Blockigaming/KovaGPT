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
    data-ui-reference="chatgpt.slider"
    ref={ref}
    className={cn(
      "relative flex min-h-8 w-full touch-none select-none items-center data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [@media(pointer:coarse)]:min-h-11",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track
      data-slot="slider-track"
      className="relative mx-[7px] h-1 w-full grow overflow-hidden rounded-[2px] bg-[#dfdfdf] dark:bg-[#414141]"
    >
      <SliderPrimitive.Range className="absolute h-full rounded-[2px] bg-[#767676] dark:bg-[#8f8f8f]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className="flex h-8 w-8 cursor-grab items-center justify-center rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      {...thumbProps}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none h-3.5 w-3.5 rounded-full bg-white shadow-[inset_0_0_0_2px_#767676] dark:bg-[#0d0d0d] dark:shadow-[inset_0_0_0_2px_#8f8f8f]"
      />
    </SliderPrimitive.Thumb>
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
