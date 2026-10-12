import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RateStatus } from '@/features/rates/RateStatus';

const now = Date.parse('2026-10-11T10:00:00Z');
const info = { source: 'open.er-api.com', time: '2026-10-11T09:00:00Z', rates: { USD: 7 } };

describe('compact rate status display', () => {
  it('places an accessible green status dot before the rate date', () => {
    const html = renderToStaticMarkup(<RateStatus info={info} currencies={['USD']} failed={false} now={now} />);
    expect(html).toContain('汇率日期：2026/10/11');
    expect(html).not.toMatch(/数据来源|更新时间|北京时间|17:00/);
    expect(html).toContain('class="rates-status-dot"'); expect(html).toContain('aria-label="汇率数据正常"');
    expect(html.indexOf('rates-status-dot')).toBeLessThan(html.indexOf('汇率日期：'));
  });
  it('uses a yellow dot for failure without displaying technical errors or cache warnings', () => {
    const html = renderToStaticMarkup(<RateStatus info={info} currencies={['USD']} failed now={now} />);
    expect(html).toContain('rates-status-warning'); expect(html).toContain('aria-label="汇率数据异常"');
    expect(html).not.toMatch(/非 JSON|安全验证|缓存|请刷新|API|获取失败/);
    expect(html).toContain('汇率日期：2026/10/11');
  });
  it('keeps missing data and missing selected currencies compact and abnormal', () => {
    const empty = renderToStaticMarkup(<RateStatus info={null} currencies={['USD']} failed now={now} />);
    expect(empty).toContain('汇率日期未知'); expect(empty).toContain('rates-status-warning'); expect(empty).not.toContain('请刷新');
    const missing = renderToStaticMarkup(<RateStatus info={info} currencies={['CHF']} failed={false} now={now} />);
    expect(missing).toContain('rates-status-warning'); expect(missing).not.toContain('部分所选币种');
  });
});
