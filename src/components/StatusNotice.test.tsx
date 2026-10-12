import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusNotice } from '@/components/StatusNotice';

describe('operation notices', () => {
  it('keeps an empty live region without displaying a notice box', () => {
    const html = renderToStaticMarkup(<StatusNotice message={null} />);
    expect(html).toContain('role="status"'); expect(html).not.toContain('<svg'); expect(html).not.toContain('status-notice-warning');
  });
  it('uses success styling and a decorative success icon for a completed operation', () => {
    const html = renderToStaticMarkup(<StatusNotice message={{ text: '草稿已保存，可在“我的单据”中查看并继续编辑。', tone: 'success' }} />);
    expect(html).toContain('草稿已保存，可在“我的单据”中查看并继续编辑。'); expect(html).toContain('role="status"');
    expect(html).toContain('aria-atomic="true"'); expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('status-notice-warning');
  });
  it('uses warning styling and an alert for failed or partially completed operations', () => {
    const html = renderToStaticMarkup(<StatusNotice message={{ text: '文件已导出，但草稿未保存。', tone: 'warning' }} />);
    expect(html).toContain('status-notice-warning'); expect(html).toContain('role="alert"'); expect(html).toContain('草稿未保存');
  });
  it('renders arbitrary server error text safely', () => {
    const html = renderToStaticMarkup(<StatusNotice message={{ text: '<script>alert(1)</script>', tone: 'warning' }} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  });
});
