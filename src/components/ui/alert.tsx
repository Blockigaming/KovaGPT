import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  // SDK Alert outline geometry, adapted to the existing composed-children API.
  "relative grid w-full grid-cols-1 items-center gap-x-3 rounded-[0.75rem] p-4 text-sm leading-5 has-[>svg]:grid-cols-[20px_minmax(0,1fr)] [&>svg]:col-start-1 [&>svg]:row-span-2 [&>svg]:row-start-1 [&>svg]:size-[20px] [&>svg]:shrink-0 [&>svg+*]:row-start-1 [&>svg~*]:col-start-2 [&>*]:min-w-0",
  {
    variants: {
      variant: {
        default:
          "bg-transparent text-foreground shadow-[inset_0_0_0_1px_rgb(13_13_13/10%)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/12%)]",
        destructive: "bg-transparent text-[#e02e2a] shadow-[inset_0_0_0_1px_#e02e2a]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    data-ui-reference="chatgpt.alert.outline"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      data-slot="alert-title"
      className={cn(
        "font-semibold leading-5 [text-wrap:pretty] [&+[data-slot=alert-description]]:mt-[2px]",
        className,
      )}
      {...props}
    />
  ),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="alert-description"
    className={cn("text-sm leading-5 [text-wrap:pretty] [&_p]:leading-5", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
