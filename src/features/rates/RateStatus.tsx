import { rateDataHealthy, rateDescription, type RateInfo } from '@/features/rates/rates';

export function RateStatus({ info, currencies, failed, now }: {
  info: RateInfo;
  currencies: readonly string[];
  failed: boolean;
  now?: number;
}) {
  const healthy = rateDataHealthy(info, currencies, failed, now);
  const label = healthy ? '汇率数据正常' : '汇率数据异常';
  return (
    <small className="rates-status" role="status">
      <span className={`rates-status-dot${healthy ? '' : ' rates-status-warning'}`} role="img" aria-label={label} title={label} />
      {rateDescription(info)}
    </small>
  );
}
