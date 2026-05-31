import { Link, useLocation } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

type NavItem = { to: string; label: string };

const ITEMS: NavItem[] = [
  { to: '/characters', label: '角色' },
  { to: '/scenes', label: '场景' },
  { to: '/props', label: '道具' },
  { to: '/benchmark', label: '视频基准' },
];

export function Nav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="inline-flex items-center rounded-md bg-[hsl(var(--muted))] p-1 text-[hsl(var(--muted-foreground))]"
    >
      {ITEMS.map((item) => {
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
              active
                ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
                : 'hover:text-[hsl(var(--foreground))]',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
