import { common, commercial, specialized, row, type Row } from '@/features/documents/model';

export function parseLocal(text: string) {
  const result: Record<string, string> = {};
  for (const [key, cn, en] of [...common, ...commercial, ...specialized.CD]) {
    const line = text
      .split("\n")
      .find(
        (l) =>
          l.toLowerCase().startsWith(cn.toLowerCase() + ":") ||
          l.toLowerCase().startsWith(en.toLowerCase() + ":") ||
          l.startsWith(cn + "："),
      );
    if (line)
      result[key] = line
        .slice(Math.max(line.indexOf(":"), line.indexOf("：")) + 1)
        .trim();
  }
  const products: Row[] = [];
  for (const l of text.split("\n")) {
    const p = l.split(/\t|,/).map((s) => s.trim());
    if (
      p.length >= 3 &&
      p[0] &&
      /^\d+(\.\d+)?$/.test(p[1]) &&
      /^\d+(\.\d+)?$/.test(p[2])
    )
      products.push({
        ...row(),
        name: p[0],
        qty: p[1],
        price: p[2],
        unit: p[3] || "PCS",
      });
  }
  return { fields: result, rows: products };
}
