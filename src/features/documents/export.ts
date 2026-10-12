import Decimal from 'decimal.js';
import { columns, fields, types, type Doc, type Field } from '@/features/documents/model';
import { totals, amount } from '@/features/documents/calculations';
import { assertExportable, numeric } from '@/features/documents/validation';
import { presetText } from '@/features/documents/reference-model';
import { createPdfPages } from '@/features/documents/pdf-pages';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function spreadsheetNumber(value: string, computed = false): string | number | null {
  if (!value.trim()) return null;
  const result = computed ? { state: 'valid' as const, value: new Decimal(value) } : numeric(value);
  if (result.state === 'empty') return null;
  if (result.state === 'invalid') throw Error(result.message);
  const n = Number(result.value.toString());
  return result.value.sd() <= 15 && new Decimal(n).eq(result.value) ? n : result.value.toString();
}
async function imageForWorkbook(image: string) {
  if (!image.startsWith('data:image/webp;')) return image;
  const img = new Image(); img.src = image; await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw Error('无法转换 WebP 图片');
  context.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function createWorkbook(d: Doc) {
  assertExportable(d);
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(d.kind);
  const label = (zh: string, en: string) => d.language === 'zh' ? zh : d.language === 'en' ? en : zh + ' / ' + en;
  const cols: Field[] = [['index', '#', '#'], ...columns(d.kind), ['amount', '金额', 'Amount'], ['nameEn', '英文名称', 'English name'], ['image', '产品图片', 'Product image']];
  sheet.columns = cols.map(([key]) => ({ key, width: ['name', 'nameEn', 'spec'].includes(key) ? 30 : 18 }));
  sheet.addRow([label(types[d.kind][0], types[d.kind][1])]);
  for (const [key, zh, en] of fields(d.kind)) sheet.addRow([label(zh, en), ['incoterm', 'payment', 'delivery'].includes(key) ? presetText(d.fields[key] || '', d.language) : d.fields[key] || '']);
  sheet.addRow([]);
  const header = sheet.addRow(cols.map(([, zh, en]) => label(zh, en)));
  const images: { value: string; row: number; column: number }[] = [];
  for (const [i, r] of d.rows.entries()) {
    const output = sheet.addRow(cols.map(([key]) => key === 'index' ? i + 1 : key === 'amount' ? spreadsheetNumber(amount(r), true) : key === 'name' ? r.name : key === 'unit' ? presetText(r.unit, d.language) : key === 'image' ? '' : ['qty', 'price'].includes(key) ? spreadsheetNumber(r[key as 'qty' | 'price']) : r[key as keyof typeof r]));
    if (r.image) images.push({ value: r.image, row: output.number - 1, column: cols.findIndex(c => c[0] === 'image') });
  }
  if (d.kind === 'PI') {
    sheet.addRow([label('产品金额', 'Subtotal'), totals(d).subtotal]);
    sheet.addRow([label('运费', 'Freight'), d.fields.freight.trim() === '' ? null : spreadsheetNumber(d.fields.freight)]);
  }
  sheet.addRow([label('合计', 'Total') + ' ' + d.fields.currency, totals(d).total]);
  sheet.addRow([label('补充说明', 'Notes'), d.notes]);
  sheet.eachRow(r => {
    r.height = 32;
    r.eachCell(c => {
      c.alignment = { vertical: 'middle', wrapText: true };
      c.font = { name: 'Arial', size: 11 };
      c.border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } };
    });
  });
  sheet.getRow(1).font = { bold: true, size: 18 };
  header.font = { bold: true, name: 'Arial', size: 11 };
  sheet.views = [{ state: 'frozen', ySplit: header.number }];
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  if (d.logo) images.push({ value: d.logo, row: 0, column: cols.length - 1 });
  for (const image of images) {
    const base64 = await imageForWorkbook(image.value);
    const extension = base64.startsWith('data:image/jpeg;') ? 'jpeg' : base64.startsWith('data:image/gif;') ? 'gif' : 'png';
    const id = book.addImage({ base64, extension });
    sheet.getRow(image.row + 1).height = 60;
    sheet.addImage(id, { tl: { col: image.column, row: image.row }, ext: { width: 72, height: 72 } });
  }
  return book;
}
export async function excel(d: Doc) {
  const book = await createWorkbook(d);
  const buffer = await book.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${d.fields.number}.xlsx`);
}
export async function printDocument(d: Doc) {
  assertExportable(d);
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.preview > .paper'));
  if (!pages.length) throw Error('未找到当前单据预览');
  await document.fonts.ready;
  await Promise.all(pages.flatMap(page => Array.from(page.querySelectorAll('img')).map(image => image.decode())));
  window.print();
}
export async function pdf(d: Doc) {
  assertExportable(d);
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.preview > .paper'));
  if (!pages.length) throw Error('未找到当前单据预览');
  const result = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  let pageCount = 0;
  for (const source of pages) {
    const layout = await createPdfPages(source);
    try {
      for (const page of layout.pages) {
        const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: false });
        if (pageCount++) result.addPage();
        const ratio = 190 / canvas.width;
        result.addImage(canvas.toDataURL('image/jpeg', .95), 'JPEG', 10, 10, 190, canvas.height * ratio);
      }
    } finally { layout.dispose(); }
  }
  for (let page = 1; page <= pageCount; page++) {
    result.setPage(page); result.setFontSize(9); result.setTextColor(100);
    result.text(`${page} / ${pageCount}`, 200, 293, { align: 'right' });
  }
  result.save(`${d.fields.number}.pdf`);
}
