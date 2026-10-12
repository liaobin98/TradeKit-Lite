import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
export function Checkbox(
  props: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
) {
  return (
    <CheckboxPrimitive.Root
      className="ui-checkbox inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        {props.checked === 'indeterminate' ? <Minus size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
