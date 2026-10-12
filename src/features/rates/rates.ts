export type RateInfo = { source?: string; time?: string; rates?: Record<string, unknown> } | null | undefined;

export const rateCurrencies = [
  ['USD', '美元'], ['EUR', '欧元'], ['GBP', '英镑'], ['JPY', '日元'],
  ['HKD', '港币'], ['AUD', '澳元'], ['CAD', '加元'], ['CHF', '瑞士法郎'],
  ['SGD', '新加坡元'], ['NZD', '新西兰元'], ['KRW', '韩元'], ['THB', '泰铢'],
  ['AED', '阿联酋迪拉姆'], ['SAR', '沙特里亚尔'], ['QAR', '卡塔尔里亚尔'],
  ['INR', '印度卢比'], ['MYR', '马来西亚林吉特'], ['IDR', '印尼盾'],
  ['VND', '越南盾'], ['PHP', '菲律宾比索'], ['TWD', '新台币'],
  ['RUB', '俄罗斯卢布'], ['BRL', '巴西雷亚尔'], ['ZAR', '南非兰特'],
  ['MXN', '墨西哥比索'], ['TRY', '土耳其里拉'],
] as const;
export type RateCurrency = typeof rateCurrencies[number][0];
export const defaultRateCurrencies = ['USD', 'EUR', 'GBP', 'AED'] as const;

export function readRateCurrencies(raw: string | null): RateCurrency[] {
  try {
    const saved: unknown = JSON.parse(raw || 'null');
    return defaultRateCurrencies.map((fallback, index) => {
      const code = Array.isArray(saved) ? saved[index] : undefined;
      return rateCurrencies.some(([value]) => value === code) ? code as RateCurrency : fallback;
    });
  } catch {
    return [...defaultRateCurrencies];
  }
}

export function formatRate(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  const fixed = value.toFixed(4);
  return Number(fixed) === 0 ? value.toPrecision(3) : fixed;
}

export function rateDescription(info: RateInfo) {
  const date = info?.time ? new Date(info.time) : null;
  if (!date || !Number.isFinite(date.getTime()))
    return "汇率日期未知";
  // The upstream snapshot date, not the browser refresh/fetch date or a bank quote date.
  const day = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `汇率日期：${day}`;
}

export function rateDataHealthy(info: RateInfo, currencies: readonly string[], failed: boolean, now = Date.now()) {
  if (!info || failed || !info.time || currencies.length === 0) return false;
  const updated = new Date(info.time).getTime();
  return Number.isFinite(updated) && updated <= now && now - updated <= 36 * 3600000 &&
    currencies.every(code => formatRate(info.rates?.[code]) !== '—');
}
