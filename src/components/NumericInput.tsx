import { useId } from 'react';
import { Input } from '@/components/ui/input';
import type { ValidationIssue } from '@/features/documents/validation';
export function NumericInput({ label, value, onChange, issue, placeholder, hint }: {
  label: string; value: string; onChange: (value: string) => void; issue?: ValidationIssue; placeholder?: string; hint?: string;
}) {
  const id = useId();
  return <div className="numeric-control"><Input id={id} type="text" inputMode="decimal" aria-label={label}
    value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    aria-invalid={!!issue} aria-describedby={issue || hint ? id + '-help' : undefined} />
    {(issue || hint) && <small id={id + '-help'} className={issue ? 'field-error' : 'field-help'}>{issue?.message || hint}</small>}
  </div>;
}
