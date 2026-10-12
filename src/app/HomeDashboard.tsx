import { FileSpreadsheet, ClipboardList, FileCheck2, FileText, Package, Ship, Globe, ChartLine, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/controls';
import { types, type Kind } from '@/features/documents/model';
import { cities, clock } from '@/features/world-clock/clock';
import type { useWorldClock } from '@/features/world-clock/useWorldClock';
import { RateStatus } from '@/features/rates/RateStatus';
import { rateCurrencies, formatRate, type RateCurrency } from '@/features/rates/rates';
import type { useRates } from '@/features/rates/useRates';

const icons = [
  FileSpreadsheet,
  ClipboardList,
  FileCheck2,
  FileText,
  Package,
  Ship,
];
const descriptions = [
  "产品、数量、价格与贸易条款",
  "付款、交期与银行信息",
  "正式条款、签章与责任",
  "出口、收款与清关资料",
  "箱数、重量、体积与唛头",
  "申报要素、运输与海关商品信息",
];

type Props = {
  busy: boolean;
  startHomeDocument: (kind: Kind) => Promise<void>;
  persist: (key: string, value: unknown) => Promise<boolean>;
  worldClock: ReturnType<typeof useWorldClock>;
  exchangeRates: ReturnType<typeof useRates>;
};

export function HomeDashboard({ busy, startHomeDocument, persist, worldClock, exchangeRates }: Props) {
  const { now, zones, setZones } = worldClock;
  const { rates, ratesFailed, refreshingRates, refreshRates, selectedRateCurrencies, setSelectedRateCurrencies } = exchangeRates;
  return (
    <>
      <div className="dashboard">
        <section className="clock-card">
          <div className="card-heading">
            <span className="module-icon">
              <Globe size={16} />
            </span>
            <h2>
              世界时间<small>WORLD DESKS</small>
            </h2>
          </div>
          <div className="clocks">
            {zones.map((z, i) => {
              const c = clock(now, z);
              return (
                <div key={i}>
                  <SelectField
                    label={`时钟 ${i + 1} 城市`}
                    value={z}
                    options={cities.map(([label, value]) => ({
                      label,
                      value,
                    }))}
                    onValueChange={(value) => {
                      const v = zones.map((x, n) =>
                        n === i ? value : x,
                      );
                      setZones(v);
                      persist("zones", v);
                    }}
                  />
                  <strong>{c.time}</strong>
                  <small>{c.date}</small>
                  <span className={c.office ? "office office-active" : "office"}>
                    {c.office ? "● 办公中" : "● 非办公时段"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="rates-card">
          <div className="card-heading">
            <span className="module-icon" aria-hidden="true">
              <ChartLine size={18} />
            </span>
            <h2 className="text-balance">
              参考汇率<small>LIVE EXCHANGE</small>
            </h2>
            <div className="rates-heading-actions">
              <RateStatus info={rates} currencies={selectedRateCurrencies} failed={ratesFailed} now={now.getTime()} />
              <Button
                onClick={refreshRates}
                disabled={refreshingRates}
                aria-busy={refreshingRates}
                aria-label={refreshingRates ? "正在刷新汇率" : "刷新汇率"}
                title="刷新汇率"
              >
                <RefreshCw
                  size={17}
                  aria-hidden="true"
                  className={refreshingRates ? "rates-refresh-spinning" : undefined}
                />
              </Button>
            </div>
          </div>
          <div className="rates-content">
            <div className="rates">
              {selectedRateCurrencies.map((code, index) => {
                const value = formatRate(rates?.rates?.[code]);
                return (
                  <div key={index}>
                    <SelectField
                      label={`汇率 ${index + 1} 币种`}
                      value={code}
                      displayValue={`${code} / CNY`}
                      options={rateCurrencies.map(([value, name]) => ({ value, label: `${value} / ${name}` }))}
                      onValueChange={(value) => {
                        const next = selectedRateCurrencies.map((current, slot) => slot === index ? value as RateCurrency : current);
                        setSelectedRateCurrencies(next);
                        persist('rate-currencies', next);
                        if (formatRate(rates?.rates?.[value]) === '—') void refreshRates();
                      }}
                    />
                    <strong className="tabular-nums" aria-busy={value === '—' && refreshingRates} aria-label={`${code} 兑人民币参考汇率：${value === '—' ? refreshingRates ? '正在获取' : '暂无数据' : value}`} title={value === '—' ? refreshingRates ? '正在获取该币种的参考汇率。' : '当前数据源暂无该币种汇率，请刷新重试。' : undefined}>{value}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
      <div className="entries">
        {(Object.keys(types) as Kind[]).map((k, i) => {
          const Icon = icons[i];
          return (
            <Button key={k} onClick={() => void startHomeDocument(k)} className="entry" disabled={busy}>
              <span className="entry-icon">
                <Icon />
              </span>
              <div>
                <small className="entry-code">{k}</small>
                <h3>{k === "PI" ? "PI" : types[k][0]}</h3>
                <p>{descriptions[i]}</p>
              </div>
            </Button>
          );
        })}
      </div>
      <p className="footnote">
        资料保存在当前浏览器，请定期下载 JSON 备份。汇率仅供参考，不构成结算报价。
        <a className="site-guide-link" href="/guide/" target="_blank" rel="noopener noreferrer">使用说明与常见问题<span className="sr-only">（在新标签页打开）</span></a>
      </p>
      <p className="footnote resolution-hint">
        桌面建议使用 1280px 及以上宽度浏览，浏览器缩放建议为 100%。
      </p>
    </>
  );
}
