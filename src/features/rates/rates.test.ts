import { describe, expect, it } from "vitest";
import { rateDescription, rateCurrencies, defaultRateCurrencies, readRateCurrencies, formatRate, rateDataHealthy } from "@/features/rates/rates";

describe("Chinese exchange rate description", () => {
  it("shows only the source snapshot date in Beijing time", () => {
    const description = rateDescription({
      source: "ExchangeRate-API · open.er-api.com",
      time: "Sun, 11 Oct 2026 00:02:31 +0000",
    });
    expect(description).toBe("汇率日期：2026/10/11");
    expect(description).not.toMatch(/Sun|GMT|ExchangeRate|数据来源|更新时间|北京时间|08:02/);
  });

  it("keeps the Beijing calendar date when UTC is still the previous day", () => {
    expect(rateDescription({ time: "2026-10-10T20:02:31Z" })).toBe("汇率日期：2026/10/11");
  });

  it("handles absent or invalid timestamps without inventing an update time", () => {
    expect(rateDescription(null)).toBe("汇率日期未知");
    expect(rateDescription({ source: "自定义汇率数据源", time: "invalid" }))
      .toBe("汇率日期未知");
    expect(rateDescription({ source: "ExchangeRate-API · open.er-api.com" }))
      .toBe("汇率日期未知");
  });
});

describe('exchange rate data status', () => {
  const now = Date.parse('2026-10-11T10:00:00Z');
  const info = { source: 'open.er-api.com', time: '2026-10-11T09:00:00Z', rates: { USD: 7, EUR: 8 } };
  it('is healthy only for fresh valid selected rates after a successful request', () => {
    expect(rateDataHealthy(info, ['USD', 'EUR'], false, now)).toBe(true);
    expect(rateDataHealthy(info, ['USD', 'EUR'], true, now)).toBe(false);
  });
  it('marks absent and incomplete data as abnormal', () => {
    expect(rateDataHealthy(null, ['USD'], false, now)).toBe(false);
    expect(rateDataHealthy(info, ['CHF'], false, now)).toBe(false);
    expect(rateDataHealthy(info, [], false, now)).toBe(false);
    expect(rateDataHealthy({ ...info, rates: { USD: 0 } }, ['USD'], false, now)).toBe(false);
  });
  it('marks expired, invalid and future update times as abnormal', () => {
    for (const time of ['', 'invalid', '2026-10-09T09:00:00Z', '2026-10-12T09:00:00Z']) {
      expect(rateDataHealthy({ ...info, time }, ['USD'], false, now)).toBe(false);
    }
  });
});

describe('selectable reference currencies', () => {
  it('includes common trade currencies without duplicate or invalid codes', () => {
    const codes = rateCurrencies.map(([code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining(['USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'CHF', 'SGD', 'AED', 'KRW', 'VND']));
    expect(codes.every(code => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(codes).not.toContain('CNY');
  });

  it('restores exactly four independent selections, including duplicate currencies', () => {
    expect(readRateCurrencies('["JPY","HKD","CAD","SGD"]')).toEqual(['JPY', 'HKD', 'CAD', 'SGD']);
    expect(readRateCurrencies('["JPY","JPY","CAD","SGD","EUR"]')).toEqual(['JPY', 'JPY', 'CAD', 'SGD']);
    expect(readRateCurrencies('["JPY","bad",null]')).toEqual(['JPY', 'EUR', 'GBP', 'AED']);
  });

  it.each([null, 'broken', '{}', 'null', '1', '"JPY"'])('falls back safely for corrupt or absent preferences %s', raw => {
    expect(readRateCurrencies(raw)).toEqual(defaultRateCurrencies);
  });

  it.each([undefined, null, '7', 0, -1, NaN, Infinity])('does not show missing or invalid rates as zero: %s', value => {
    expect(formatRate(value)).toBe('—');
  });

  it('keeps four decimal places without rounding tiny valid rates to zero', () => {
    expect(formatRate(7)).toBe('7.0000');
    expect(formatRate(0.0466666667)).toBe('0.0467');
    expect(Number(formatRate(0.0000001))).toBeGreaterThan(0);
  });
});
