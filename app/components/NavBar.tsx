'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavBar() {
  const path = usePathname();

  const tabs = [
    { href: '/', label: '🔥 Sales Board' },
    { href: '/setters', label: '📅 Setter Board' },
  ];

  return (
    <nav
      style={{
        background: '#050D18',
        borderBottom: '1px solid #0F2040',
      }}
    >
      <div
        style={{ maxWidth: 1200 }}
        className="mx-auto px-4 sm:px-6 flex items-center gap-1 h-11"
      >
        {tabs.map(tab => {
          const active = tab.href === '/' ? path === '/' : path.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all"
              style={{
                background: active ? 'rgba(201,168,76,0.15)' : 'transparent',
                color: active ? '#C9A84C' : '#4A6A8A',
                border: active ? '1px solid rgba(201,168,76,0.3)' : '1px solid transparent',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
