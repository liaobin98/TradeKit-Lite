import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '@/lib/api';
import { KEY, workspaceStorage } from '@/features/workspace/workspace-storage';
import { defaultRateCurrencies, readRateCurrencies, type RateCurrency, type RateInfo } from '@/features/rates/rates';

export function useRates(persist: (key: string, value: unknown) => Promise<boolean>) {
  const [selectedRateCurrencies, setSelectedRateCurrencies] = useState<RateCurrency[]>(() => {
    try { return readRateCurrencies(workspaceStorage().getItem(KEY + 'rate-currencies')); }
    catch { return [...defaultRateCurrencies]; }
  });
  const [rates, setRates] = useState<RateInfo>(() => {
      try {
        return JSON.parse(workspaceStorage().getItem(KEY + "rates") || "null");
      } catch {
        return null;
      }
    }),
    [ratesFailed, setRatesFailed] = useState(true),
    [refreshingRates, setRefreshingRates] = useState(false);
  const ratesRequestPending = useRef(false);
  async function refreshRates() {
    if (ratesRequestPending.current) return;
    ratesRequestPending.current = true;
    setRefreshingRates(true);
    try {
      const d = await fetchJson("/api/rates");
      if (!defaultRateCurrencies.every((key) =>
        typeof d.rates?.[key] === "number" && Number.isFinite(d.rates[key]) && d.rates[key] > 0,
      )) throw Error("服务返回的汇率数据不正确");
      setRates(d);
      persist("rates", d);
      setRatesFailed(false);
    } catch {
      setRatesFailed(true);
    } finally {
      ratesRequestPending.current = false;
      setRefreshingRates(false);
    }
  }
  useEffect(() => { void refreshRates(); }, []);
  return { rates, ratesFailed, refreshingRates, refreshRates, selectedRateCurrencies, setSelectedRateCurrencies };
}
