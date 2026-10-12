// Adapted from shadcn/ui's MIT-licensed Input. See ./LICENSE.
// Source: https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/ui
import * as React from "react";
import { cn } from "@/lib/utils";
import { controlStyles } from "@/components/ui/control-styles";
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        controlStyles,
        "ui-input file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
));
Input.displayName = "Input";
