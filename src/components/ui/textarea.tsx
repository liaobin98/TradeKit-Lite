// Adapted from shadcn/ui's MIT-licensed Textarea. See ./LICENSE.
// Source: https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/ui
import * as React from "react";
import { cn } from "@/lib/utils";
import { controlStyles } from "@/components/ui/control-styles";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="textarea"
    className={cn(controlStyles, "ui-textarea min-h-16 resize-y py-2", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
