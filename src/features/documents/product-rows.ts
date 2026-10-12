import { row, type Row } from '@/features/documents/model';

export function needsProductRemovalConfirmation(product: Row): boolean {
  const filled = Object.entries(product).filter(([key, value]) => {
    const text = value.trim();
    if (key === 'id' || !text) return false;
    if (key === 'unit' && text === '件 / PCS') return false;
    if (key === 'cartons' && Number(text) === 0) return false;
    return true;
  });
  return filled.length >= 2;
}

export function copyProductRow(rows: Row[], id: string): Row[] {
  const index = rows.findIndex(product => product.id === id);
  if (index === -1) return rows;
  const copy = { ...rows[index], id: crypto.randomUUID() };
  return [...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)];
}

export function removeProductRow(rows: Row[], id: string): Row[] {
  if (!rows.some(product => product.id === id)) return rows;
  const remaining = rows.filter(product => product.id !== id);
  return remaining.length ? remaining : [row()];
}
