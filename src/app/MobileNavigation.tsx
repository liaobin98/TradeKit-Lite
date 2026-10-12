import { useEffect, useRef, useState, type RefObject } from 'react';
import { Archive, Building2, Files, Home, Menu, Package, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ProjectLinkItems } from '@/app/ProjectLinks';
import type { CatalogRoute } from '@/app/navigation';
import '@/app/mobile-navigation.css';

export function MobileNavigation({ current, busy, triggerRef, onNavigate, onBackup }: {
  current: 'home' | 'documents' | CatalogRoute | null;
  busy: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onNavigate: (destination: 'home' | 'documents' | CatalogRoute) => void;
  onBackup: () => void;
}) {
  const [open, setOpen] = useState(false);
  const openingBackup = useRef(false);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 769px)');
    const resized = () => { if (window.innerWidth >= 769) setOpen(false); };
    desktop.addEventListener('change', resized);
    window.addEventListener('resize', resized);
    return () => { desktop.removeEventListener('change', resized); window.removeEventListener('resize', resized); };
  }, []);
  const entries = [
    { destination: 'home' as const, label: '首页', icon: Home },
    { destination: 'documents' as const, label: '我的单据', icon: Files },
    { destination: 'sellers' as const, label: '卖方', icon: Building2 },
    { destination: 'buyers' as const, label: '买方', icon: Users },
    { destination: 'products' as const, label: '产品', icon: Package },
  ];
  return <div className="mobile-navigation">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} variant="ghost" className="mobile-menu-trigger" disabled={busy} aria-label={open ? '收起导航菜单' : '展开导航菜单'}>
          <Menu size={24} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="mobile-site-menu" align="end" sideOffset={8} aria-label="导航菜单" onCloseAutoFocus={event => {
        // The backup dialog owns focus after this menu closes.
        if (openingBackup.current) { event.preventDefault(); openingBackup.current = false; }
        else if (window.matchMedia('(min-width: 769px)').matches) {
          event.preventDefault();
          (document.querySelector<HTMLButtonElement>('.site-navigation [aria-current="page"]') ?? document.querySelector<HTMLButtonElement>('.site-brand'))?.focus();
        }
      }}>
        <nav aria-label="移动端主导航">
          {entries.map(({ destination, label, icon: Icon }) => <Button key={destination} variant="ghost" className="mobile-navigation-link" disabled={busy}
            aria-current={current === destination ? 'page' : undefined} onClick={() => { setOpen(false); onNavigate(destination); }}>
            <Icon size={20} aria-hidden="true" />{label}
          </Button>)}
        </nav>
        <div className="mobile-menu-section">
          <Button variant="ghost" className="mobile-navigation-link" disabled={busy} onClick={() => {
            openingBackup.current = true; setOpen(false); onBackup();
          }}><Archive size={20} aria-hidden="true" />备份 / 恢复</Button>
        </div>
        <div className="mobile-menu-section">
          <nav aria-label="项目信息"><ProjectLinkItems onNavigate={() => setOpen(false)} /></nav>
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
