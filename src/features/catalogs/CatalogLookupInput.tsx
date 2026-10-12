import { useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { catalogSelections, readLookupCatalog, type CatalogSelection } from '@/features/catalogs/catalog-lookup';
import { catalogLabels, catalogValue, searchFormCatalog, type CatalogRecord } from '@/features/catalogs/form-catalog';
import type { CatalogRoute } from '@/app/navigation';
import { types } from '@/features/documents/model';
import '@/features/catalogs/catalog-lookup.css';

function readRecords(category: CatalogRoute): { records: CatalogRecord[]; error: string } {
  try { return { records: readLookupCatalog(category), error: '' }; }
  catch { return { records: [], error: '无法读取已有资料，仍可直接手动填写。' }; }
}

export function CatalogLookupInput({ category, label, value, onChange, onSelect, showLabel = false, disabled = false, placeholder }: {
  category: CatalogRoute;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (selection: CatalogSelection) => string;
  showLabel?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId(), helpId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  // Independent copies survive source edits; re-read them so deleted copies never linger here.
  const [saved, setSaved] = useState(() => readRecords(category));
  const [warning, setWarning] = useState('');
  const choices = catalogSelections(searchFormCatalog(saved.records, query));
  const labelName = catalogLabels[category];
  return (
    <div className="catalog-lookup-field">
      {showLabel && <label htmlFor={id}>{label}</label>}
      <Popover open={open && !disabled} onOpenChange={next => {
        if (next) {
          const fresh = readRecords(category);
          setSaved(fresh);
          setQuery(value);
        }
        setOpen(next && !disabled);
      }}>
        <PopoverAnchor asChild>
          <div className="catalog-lookup-input">
            <Input ref={input} id={id} aria-label={label} aria-describedby={warning ? helpId : undefined} value={value} disabled={disabled} placeholder={placeholder} onChange={event => { setWarning(''); onChange(event.target.value); }} />
            <PopoverTrigger asChild><Button variant="ghost" size="icon" className="catalog-lookup-trigger" disabled={disabled} aria-label={`检索已有${labelName}资料`} aria-haspopup="dialog"><Search size={16} aria-hidden="true" /></Button></PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent className="catalog-lookup-popover" aria-label={`${labelName}资料检索`} onCloseAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
          <Command shouldFilter={false} label={`${labelName}资料检索`}>
            <CommandInput aria-label={`搜索已有${labelName}资料`} placeholder="输入名称、联系人、编码或单据编号" value={query} onValueChange={setQuery} autoFocus />
            {saved.error && <p className="catalog-lookup-note" role="alert">{saved.error}</p>}
            <CommandList>
              {choices.length === 0 ? <p className="catalog-lookup-note">没有匹配的资料，可继续手动填写。</p> : <CommandGroup heading="选择后带入资料">
                {choices.map((selection, index) => {
                  const { record, source } = selection;
                  const details = category === 'products'
                    ? [catalogValue(record, 'code'), catalogValue(record, 'spec'), source.row?.price ? `${source.currency || '未知币种'} ${source.row.price}` : '']
                    : [catalogValue(record, category === 'sellers' ? 'sellerContact' : 'buyerContact'), catalogValue(record, category === 'sellers' ? 'sellerPhone' : 'buyerPhone'), catalogValue(record, category === 'sellers' ? 'sellerAddress' : 'buyerAddress')];
                  return <CommandItem key={`${record.id}-${index}`} value={`saved-${index}`} onSelect={() => { setWarning(onSelect(selection)); setOpen(false); }}>
                    <span className="catalog-lookup-option"><strong>{record.title}</strong><small>{details.filter(Boolean).join(' · ')}</small><small>{types[source.kind][0]} · {source.number || '未填写编号'}{source.version === 'previous' ? ' · 上次保存版本' : ''}</small></span>
                  </CommandItem>;
                })}
              </CommandGroup>}
              <CommandGroup><CommandItem value="manual-entry" onSelect={() => { onChange(query); setWarning(''); setOpen(false); }}>继续手动填写{query.trim() ? `：${query.trim()}` : ''}</CommandItem></CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {warning && <p id={helpId} className="catalog-lookup-warning" role="status">{warning}</p>}
    </div>
  );
}
