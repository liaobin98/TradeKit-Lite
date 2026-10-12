import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Ordinary dialogs and confirmation dialogs share the backup dialog's surface.
export const dialogContentClass = 'ui-dialog fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-input bg-background p-6 shadow-xl';
export const dialogOverlayClass = 'ui-overlay fixed inset-0 z-50 bg-black/45';

export const DialogCloseButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => <button
    ref={ref}
    type="button"
    aria-label="关闭弹窗"
    className={cn('ui-dialog-close ui-dialog-close-round absolute right-4 top-4 focus-visible:ring-2 focus-visible:ring-ring', className)}
    {...props}
  ><X size={22} aria-hidden="true" /></button>,
);
DialogCloseButton.displayName = 'DialogCloseButton';
