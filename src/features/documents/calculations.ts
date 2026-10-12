import Decimal from 'decimal.js';
import { numeric } from '@/features/documents/validation';
import { type Row, type Doc } from '@/features/documents/model';

export function decimal(v: string) {
  const result = numeric(v || '');
  if (result.state === 'invalid') throw Error(result.message);
  return result.state === 'valid' ? result.value : new Decimal(0);
}
export function amount(r: Row) {
  const qty = numeric(r.qty), price = numeric(r.price);
  if (qty.state === 'invalid' || price.state === 'invalid') return '—';
  if (qty.state === 'empty' || price.state === 'empty') return '';
  const value = qty.value.mul(price.value);
  return value.gt('1000000000000000') ? '—' : value.toFixed(2);
}
export function totals(d: Doc) {
  if (d.rows.some(r => amount(r) === '—') || (d.kind === 'PI' && numeric(d.fields.freight || '').state === 'invalid')) return { subtotal: '—', total: '—' };
  const subtotal = d.rows.reduce(
    (a, r) => a.plus(amount(r) || 0),
    new Decimal(0),
  );
  return {
    subtotal: subtotal.toFixed(2),
    total: subtotal
      .plus(d.kind === 'PI' ? decimal(d.fields.freight) : 0)
      .toFixed(2),
  };
}
