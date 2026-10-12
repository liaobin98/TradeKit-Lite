import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function ProductRowDelete({ number, disabled, needsConfirmation, onRemove, onRemovedFocus }: {
  number: number;
  disabled: boolean;
  needsConfirmation: boolean;
  onRemove: () => void;
  onRemovedFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [alignOffset, setAlignOffset] = useState(0);
  const alignActions = useCallback((content: HTMLDivElement | null) => {
    const actions = content?.querySelector('.ui-dialog-actions');
    if (!content || !actions) return;
    // Anchor the actions, not the leading prompt, to the deletion button.
    setAlignOffset(-(actions.getBoundingClientRect().left - content.getBoundingClientRect().left));
  }, []);
  const title = useId(), cancel = useRef<HTMLButtonElement>(null), removed = useRef(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function remove() {
    if (disabled) return;
    removed.current = true;
    setOpen(false);
    onRemove();
    setTimeout(onRemovedFocus, 0);
  }
  return <Popover modal open={open && !disabled} onOpenChange={next => {
    if (disabled) return;
    if (next && !needsConfirmation) { remove(); return; }
    if (next) removed.current = false;
    setOpen(next);
  }}>
    <PopoverTrigger asChild><Button size="icon" disabled={disabled} aria-label={`删除产品 ${number}`} title="删除这个产品">
      <Trash2 size={14} aria-hidden="true" />
    </Button></PopoverTrigger>
    <PopoverContent ref={alignActions} className="product-delete-confirm" side="top" align="start" alignOffset={alignOffset} sideOffset={8} collisionPadding={16}
      aria-labelledby={title} aria-describedby={undefined}
      onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus({ preventScroll: true }); }}
      onCloseAutoFocus={event => { if (removed.current) { event.preventDefault(); setTimeout(onRemovedFocus, 0); } }}>
      <p id={title} className="text-pretty">确认要删除吗？</p>
      <div className="ui-dialog-actions">
        <Button ref={cancel} onClick={() => setOpen(false)}>取消</Button>
        <Button variant="default" disabled={disabled} onClick={remove}>确认</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
