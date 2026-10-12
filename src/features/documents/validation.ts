import Decimal from 'decimal.js';
import { type Doc } from '@/features/documents/model';

// Two allowed inputs can each have 18 significant digits; retain their full product before rounding.
Decimal.set({ precision: 40 });

export type NumericResult = { state: 'empty' } | { state: 'invalid'; message: string } | { state: 'valid'; value: Decimal };
export type ValidationIssue = { path: string; label: string; message: string };
const MAX = new Decimal('1000000000000');
export function numeric(value: string, options: { unit?: 'weight' | 'volume'; integer?: boolean } = {}): NumericResult {
  const text = value.trim();
  if (!text) return { state: 'empty' };
  if (text.length > 64) return { state: 'invalid', message: '数值文本不能超过 64 个字符' };
  const match = text.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([^\d\s].*)?$/);
  if (!match) return { state: 'invalid', message: '请输入非负十进制数，不支持负数或科学计数法' };
  const suffix = (match[2] || '').trim().toLowerCase();
  let factor = '1';
  if (options.unit === 'weight') {
    const factors: Record<string, string> = { '': '1', kg: '1', '千克': '1', '公斤': '1', g: '0.001', '克': '0.001', t: '1000', mt: '1000', '吨': '1000', lb: '0.45359237', lbs: '0.45359237', oz: '0.028349523125' };
    if (!(suffix in factors)) return { state: 'invalid', message: '重量支持 kg、g、t、lb、oz；不带单位按 kg 计算' };
    factor = factors[suffix];
  } else if (options.unit === 'volume') {
    if (!['', 'cbm', 'm3', 'm³', '立方米'].includes(suffix)) return { state: 'invalid', message: '体积请使用 CBM / m³' };
  } else if (suffix) return { state: 'invalid', message: '此处仅填写数值，不要附加单位或文字' };
  if ((match[1].split('.')[1] || '').length > 6) return { state: 'invalid', message: '最多支持 6 位小数' };
  const n = new Decimal(match[1]);
  if (n.gt(MAX)) return { state: 'invalid', message: '数值不能超过 1,000,000,000,000' };
  if (options.integer && !n.isInteger()) return { state: 'invalid', message: '件数必须是非负整数' };
  return { state: 'valid', value: n.mul(factor) };
}
export function validateDoc(doc: Doc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const check = (path: string, label: string, value: string, options?: Parameters<typeof numeric>[1]) => {
    const result = numeric(value || '', options);
    if (result.state === 'invalid') issues.push({ path, label, message: result.message! });
    return result;
  };
  const compare = (net: NumericResult, gross: NumericResult, path: string, label: string) => {
    if (net.state === 'valid' && gross.state === 'valid' && net.value.gt(gross.value)) issues.push({ path, label, message: '净重不能大于毛重（已按 kg 换算比较）' });
  };
  for (const [index, r] of doc.rows.entries()) {
    const prefix = `rows.${r.id}.`;
    const qty = check(prefix + 'qty', `产品 ${index + 1} 数量`, r.qty);
    const price = check(prefix + 'price', `产品 ${index + 1} 单价`, r.price);
    if (qty.state === 'valid' && price.state === 'valid' && qty.value.mul(price.value).gt('1000000000000000')) issues.push({ path: prefix + 'price', label: `产品 ${index + 1} 金额`, message: '行金额不能超过 1,000,000,000,000,000' });
    if (doc.kind === 'CD') {
      const net = check(prefix + 'net', `产品 ${index + 1} 净重`, r.net, { unit: 'weight' });
      const gross = check(prefix + 'gross', `产品 ${index + 1} 毛重`, r.gross, { unit: 'weight' });
      compare(net, gross, prefix + 'net', `产品 ${index + 1} 净重`);
      check(prefix + 'volume', `产品 ${index + 1} 体积`, r.volume, { unit: 'volume' });
    }
  }
  if (doc.kind === 'PI') check('fields.freight', '运费', doc.fields.freight);
  if (doc.kind === 'CD') {
    check('fields.totalPackages', '总件数', doc.fields.totalPackages, { integer: true });
    const net = check('fields.totalNet', '总净重', doc.fields.totalNet, { unit: 'weight' });
    const gross = check('fields.totalGross', '总毛重', doc.fields.totalGross, { unit: 'weight' });
    compare(net, gross, 'fields.totalNet', '总净重');
    check('fields.totalVolume', '总体积', doc.fields.totalVolume, { unit: 'volume' });
  }
  return issues;
}
export function assertExportable(doc: Doc) {
  const issues = validateDoc(doc);
  if (issues.length) throw Error(issues.map(i => `${i.label}：${i.message}`).join('；'));
}

// Draft output remains allowed. Issuance additionally requires the core document
// and every product row to be complete; optional business fields stay optional.
export function validateIssueCompleteness(doc: Doc): ValidationIssue[] {
  const issues = validateDoc(doc);
  const required = (path: string, label: string, value: string | undefined) => {
    if (!value?.trim()) issues.push({ path, label, message: '出单前请填写' });
  };
  for (const [key, label] of [
    ['number', '单据编号'], ['date', '日期'], ['seller', '卖方公司'],
    ['buyer', '买方公司'], ['currency', '币种'],
  ]) required(`fields.${key}`, label, doc.fields[key]);
  const date = doc.fields.date?.trim();
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    issues.push({ path: 'fields.date', label: '日期', message: '请填写有效日期（YYYY-MM-DD）' });
  }
  if (!doc.rows.length) issues.push({ path: 'rows', label: '产品明细', message: '出单前请填写至少一行完整产品' });
  for (const [index, row] of doc.rows.entries()) {
    const prefix = `rows.${row.id}.`, label = `产品 ${index + 1}`;
    required(prefix + 'name', `${label} 名称`, row.name?.trim() || row.nameEn);
    required(prefix + 'unit', `${label} 单位`, row.unit);
    required(prefix + 'qty', `${label} 数量`, row.qty);
    required(prefix + 'price', `${label} 单价`, row.price);
    const qty = numeric(row.qty || '');
    if (qty.state === 'valid' && qty.value.isZero()) issues.push({ path: prefix + 'qty', label: `${label} 数量`, message: '出单数量必须大于 0' });
  }
  return issues;
}
