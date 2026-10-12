import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileNavigation } from '@/app/MobileNavigation';
import { ProjectLinkItems } from '@/app/ProjectLinks';
import { WorkspaceBackup } from '@/features/workspace/WorkspaceBackup';

describe('mobile header menu', () => {
  it('uses a named native menu button with Radix expanded state', () => {
    const html = renderToStaticMarkup(<MobileNavigation current="home" busy={false} triggerRef={createRef()} onNavigate={vi.fn()} onBackup={vi.fn()} />);
    expect(html).toContain('aria-label="展开导航菜单"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toMatch(/<button[^>]*class="[^"]*mobile-menu-trigger/);
  });
  it('disables the menu trigger while another operation is busy', () => {
    const html = renderToStaticMarkup(<MobileNavigation current="documents" busy triggerRef={createRef()} onNavigate={vi.fn()} onBackup={vi.fn()} />);
    expect(html).toContain('disabled=""');
  });
  it('shares the same project links with their new-tab safety and accessible names', () => {
    const html = renderToStaticMarkup(<ProjectLinkItems onNavigate={vi.fn()} />);
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('GitHub（在新标签页打开）'); expect(html).toContain('更新日志（在新标签页打开）');
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
  });
  it('offers the desktop trigger and a mobile opener for one shared backup dialog', () => {
    const renderMobileMenu = vi.fn((_open, ref) => <button ref={ref}>移动菜单</button>);
    const html = renderToStaticMarkup(<WorkspaceBackup busy={false} onBusyChange={vi.fn()} prepare={vi.fn()} onRestored={vi.fn()} renderMobileMenu={renderMobileMenu} />);
    expect(html).toContain('aria-label="备份 / 恢复全部资料"'); expect(html).toContain('移动菜单');
    expect(renderMobileMenu).toHaveBeenCalledOnce();
    expect(renderMobileMenu.mock.calls[0][0]).toBeTypeOf('function');
  });
});
