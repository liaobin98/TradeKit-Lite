import { useId, useRef, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Upload, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { controlStyles, controlIconStyles } from "@/components/ui/control-styles";
import { Popover as UiPopover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogContent,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { DialogCloseButton } from '@/components/ui/dialog-style';
export function SelectField({
  value,
  displayValue,
  onValueChange,
  options,
  label,
  className,
  disabled,
}: {
  value: string;
  displayValue?: string;
  onValueChange: (v: string) => void;
  options: readonly { value: string; label: string;group?:string }[];
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Array.from(new Set(options.map(o=>o.group||''))).map(group=><SelectGroup key={group}>{group&&<SelectLabel className="px-2 py-1 text-xs font-semibold text-primary">{group}</SelectLabel>}{options.filter(o=>(o.group||'')===group).map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup>)}
      </SelectContent>
    </Select>
  );
}

export type ComboboxOption = { value: string; label: string; group?: string };

// shadcn/ui Combobox composition: Radix handles focus/portals; cmdk handles search/keyboard selection.
export function ComboboxField({ label, value, displayValue, onValueChange, options, showLabel = false, disabled = false }: {
  label: string;
  value: string;
  displayValue?: string;
  onValueChange: (value: string) => void;
  options: readonly ComboboxOption[];
  showLabel?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = options.find((option) => option.value === value);
  const choices = value && !current
    ? [...options, { value, label: displayValue ?? value, group: "当前自定义内容" }]
    : options;
  const custom = query.trim();
  const canUseCustom = custom && custom !== value && !options.some((option) => option.value === custom || option.label === custom);
  function select(next: string) {
    if (disabled) return;
    onValueChange(next);
    setOpen(false);
  }
  return (
    <div className="combobox-field">
      {showLabel && <label htmlFor={id}>{label}</label>}
      <UiPopover open={open && !disabled} onOpenChange={(next) => {
        setOpen(next && !disabled);
        if (next) setQuery(value && !current ? value : "");
      }}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn(controlStyles, "ui-select ui-combobox justify-between gap-2")}
            role="combobox"
            aria-haspopup="dialog"
            aria-label={label}
            aria-expanded={open && !disabled}
            disabled={disabled}
          >
            <span>{displayValue || current?.label || value || "请选择或输入"}</span>
            <ChevronDown data-slot="control-icon" className={controlIconStyles} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="ui-combobox-content" aria-label={`${label}选项`}>
          <Command defaultValue={value} label={`${label}选项`}>
            <CommandInput aria-label={`${label}，搜索或输入自定义内容`} placeholder="搜索或输入自定义内容…" value={query} onValueChange={setQuery} maxLength={4000} />
            <CommandList>
              <CommandEmpty>没有匹配的常用选项</CommandEmpty>
              {Array.from(new Set(choices.map((option) => option.group || "常用选项"))).map((group) => (
                <CommandGroup key={group} heading={group}>
                  {choices.filter((option) => (option.group || "常用选项") === group).map((option) => (
                    <CommandItem key={option.value} value={option.value} onSelect={() => select(option.value)}>
                      <Check className={cn("size-4 shrink-0", value === option.value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                      <span>{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {canUseCustom && <CommandGroup heading="自定义内容"><CommandItem value={custom} onSelect={() => select(custom)}><span>使用“{custom}”</span></CommandItem></CommandGroup>}
            </CommandList>
            <div className="ui-combobox-footer"><small>支持常用选项或自定义内容</small>{value && <Button variant="ghost" size="sm" onClick={() => select("")}>清空</Button>}</div>
          </Command>
        </PopoverContent>
      </UiPopover>
    </div>
  );
}
export function FilePicker({
  onFile,
  label,
  text='选择图片',
  accept='image/jpeg,image/png,image/webp,image/gif',
  disabled=false,
}: {
  onFile: (file: File) => void;
  label: string;
  text?:string;
  accept?:string;
  disabled?:boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="ui-file-picker">
      <Input
        ref={ref}
        type="file"
        disabled={disabled}
        hidden
        tabIndex={-1}
        accept={accept}
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <Button disabled={disabled} onClick={() => ref.current?.click()} aria-label={label}>
        <Upload size={14} />
        {text}
      </Button>
    </div>
  );
}
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const colors = rgb(value);
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) setDraft(value);
      }}
    >
      <Popover.Trigger asChild>
        <Button className="ui-color-trigger" aria-label="自定义主题色">
          <span style={{ background: value }} />
          {value.toUpperCase()}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ui-color-popover rounded-lg border border-input bg-popover p-4 shadow-lg"
          sideOffset={5}
          aria-label="主题颜色编辑"
        >
          <p>RGB 颜色</p>
          {colors.map((n, i) => (
            <label key={i}>
              {["红", "绿", "蓝"][i]}
              <Slider
                aria-label={["红色通道", "绿色通道", "蓝色通道"][i]}
                min={0}
                max={255}
                step={1}
                value={[n]}
                onValueChange={([v]) => {
                  const c = [...colors];
                  c[i] = v;
                  const hex =
                    "#" +
                    c.map((x) => x.toString(16).padStart(2, "0")).join("");
                  onChange(hex);
                  setDraft(hex);
                }}
              />
            </label>
          ))}
          <label>
            HEX 色值
            <Input
              value={draft}
              maxLength={7}
              onChange={(e) => {
                setDraft(e.target.value);
                if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                  onChange(e.target.value);
              }}
              aria-invalid={!/^#[0-9a-f]{6}$/i.test(draft)}
            />
          </label>
          <Popover.Close asChild>
            <Button>完成</Button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function Disclosure({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?:string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible.Root defaultOpen className="panel ui-disclosure">
      <Collapsible.Trigger asChild>
        <Button className="ui-disclosure-trigger">
          <span className="disclosure-heading"><span className="disclosure-icon"><BrainCircuit size={20}/></span><span><strong>{title}</strong>{subtitle&&<small>{subtitle}</small>}</span></span>
          <ChevronDown size={16} />
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content className="ui-disclosure-content">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
type ConfirmationOptions = { title?: string; confirmLabel?: string; cancelLabel?: string; dismissible?: boolean };

export function useConfirmation(fallbackFocus?: () => void) {
  const restoreFocus=useRef<HTMLElement|null>(null);
  const [request, setRequest] = useState<{
    content: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    dismissible?: boolean;
    resolve: (ok: boolean | null) => void;
  } | null>(null);
  function finish(ok: boolean | null) {
    request?.resolve(ok);
    setRequest(null);
  }
  function confirm(content: string, options: ConfirmationOptions & { dismissible: true }): Promise<boolean | null>;
  function confirm(content: string, options?: ConfirmationOptions): Promise<boolean>;
  function confirm(content: string, options: ConfirmationOptions = {}): Promise<boolean | null> {
    return new Promise((resolve) => {restoreFocus.current=document.activeElement as HTMLElement|null;setRequest({ content, resolve, ...options });});
  }
  return {
    confirm,
    confirmation: (
      <AlertDialog
        open={!!request}
        onOpenChange={(open) => {
          if (!open) finish(request?.dismissible ? null : false);
        }}
      >
        <AlertDialogContent
          onOverlayClick={request?.dismissible ? event => {
            if (event.target !== event.currentTarget || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            finish(null);
          } : undefined}
          onCloseAutoFocus={e=>{e.preventDefault();if(restoreFocus.current?.isConnected)restoreFocus.current.focus();else fallbackFocus?.();}}
        >
          <AlertDialogTitle className="text-balance">
            {request?.title || '请确认操作'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">{request?.content}</AlertDialogDescription>
          <div className="ui-dialog-actions">
            <AlertDialogCancel asChild>
              <Button onClick={() => finish(false)}>{request?.cancelLabel || '取消'}</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="default"
                data-testid="confirm-action"
                onClick={() => finish(true)}
              >
                {request?.confirmLabel || '确认'}
              </Button>
            </AlertDialogAction>
          </div>
          <DialogCloseButton onClick={() => finish(request?.dismissible ? null : false)} />
        </AlertDialogContent>
      </AlertDialog>
    ),
  };
}
