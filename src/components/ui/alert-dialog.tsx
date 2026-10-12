import * as React from "react";
import * as AlertPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from '@/lib/utils';
import { dialogContentClass, dialogOverlayClass } from '@/components/ui/dialog-style';
export const AlertDialog = AlertPrimitive.Root;
export const AlertDialogTitle = AlertPrimitive.Title;
export const AlertDialogDescription = AlertPrimitive.Description;
export const AlertDialogAction = AlertPrimitive.Action;
export const AlertDialogCancel = AlertPrimitive.Cancel;
type AlertDialogContentProps = React.ComponentPropsWithoutRef<typeof AlertPrimitive.Content> & {
  onOverlayClick?: React.MouseEventHandler<HTMLDivElement>;
};
export function AlertDialogContent({ children, className, onOverlayClick, ...props }: AlertDialogContentProps) {
  return (
    <AlertPrimitive.Portal>
      <AlertPrimitive.Overlay className={dialogOverlayClass} onClick={onOverlayClick} />
      <AlertPrimitive.Content className={cn(dialogContentClass, className)} {...props}>
        {children}
      </AlertPrimitive.Content>
    </AlertPrimitive.Portal>
  );
}
