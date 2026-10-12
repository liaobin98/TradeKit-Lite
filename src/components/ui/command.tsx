// Adapted from shadcn/ui's MIT-licensed Command (cmdk). See ./LICENSE.
// Source: https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/ui
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive data-slot="command" className={cn("ui-command flex w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground", className)} {...props} />;
}
export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="ui-command-input-wrapper flex items-center gap-2 border-b border-input px-3">
      <Search className="size-4 shrink-0 opacity-60" aria-hidden="true" />
      <CommandPrimitive.Input data-slot="command-input" className={cn("ui-command-input w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground", className)} {...props} />
    </div>
  );
}
export function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list" className={cn("ui-command-list max-h-72 overflow-x-hidden overflow-y-auto", className)} {...props} />;
}
export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className="py-4 text-center text-sm text-muted-foreground" {...props} />;
}
export function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group data-slot="command-group" className={cn("ui-command-group p-1", className)} {...props} />;
}
export function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return <CommandPrimitive.Item data-slot="command-item" className={cn("ui-command-item flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50", className)} {...props} />;
}
