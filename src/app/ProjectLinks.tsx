import { ChevronDown, ExternalLink, Github, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import '@/app/project-links.css';

const links = [
  { label: 'GitHub', href: 'https://github.com/liaobin98/tradekit-lite', icon: Github },
  { label: '更新日志', href: 'https://github.com/liaobin98/tradekit-lite/releases', icon: History },
];

export function ProjectLinkItems({ onNavigate }: { onNavigate?: () => void } = {}) {
  return links.map(({ label, href, icon: Icon }) => (
    <a key={href} className="project-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label}（在新标签页打开）`} onClick={onNavigate}>
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  ));
}

export function ProjectLinks() {
  return <>
    <nav className="site-project-links" aria-label="项目信息"><ProjectLinkItems /></nav>
    <div className="site-project-about">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="project-about-trigger">关于<ChevronDown size={14} aria-hidden="true" /></Button>
        </PopoverTrigger>
        <PopoverContent className="project-about-content" align="end" aria-label="关于 TradeKit Lite">
          <nav aria-label="项目信息"><ProjectLinkItems /></nav>
        </PopoverContent>
      </Popover>
    </div>
  </>;
}
