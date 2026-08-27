import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Radar, Crosshair, Eye, CheckSquare, Building2, Terminal, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewKey = 'radar' | 'strong' | 'watch' | 'applied' | 'companies' | 'system';

const NAV_ITEMS: { key: ViewKey; label: string; icon: typeof Radar }[] = [
  { key: 'radar', label: 'RADAR', icon: Radar },
  { key: 'strong', label: 'STRONG MATCHES', icon: Crosshair },
  { key: 'watch', label: 'WATCH', icon: Eye },
  { key: 'applied', label: 'APPLIED', icon: CheckSquare },
  { key: 'companies', label: 'COMPANIES', icon: Building2 },
  { key: 'system', label: 'SYSTEM', icon: Terminal },
];

interface SidebarProps {
  active: ViewKey;
  onNavigate: (view: ViewKey) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const { user, signOut } = useAuth();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    <aside className="w-56 shrink-0 bg-base-900 border-r border-base-700 flex flex-col h-full">
      <div className="px-4 py-4 border-b border-base-700">
        <div className="flex items-center gap-2">
          <div className="relative w-7 h-7 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-accent-cyan/40 animate-pulse" />
            <div className="absolute inset-1.5 rounded-full border border-accent-cyan/20" />
            <div className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-widest text-white">JOB RADAR</div>
            <div className="text-2xs text-slate-500 mono">v0.1 · OPERATIONS</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className={cn('nav-item', active === key ? 'nav-item-active' : 'nav-item-inactive')}
            onClick={() => onNavigate(key)}
          >
            <Icon size={15} className={active === key ? 'text-accent-cyan' : ''} />
            <span className="tracking-wide">{label}</span>
          </div>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-base-700">
        <div className="text-2xs text-slate-500 mb-1 mono uppercase tracking-wider">Operator</div>
        <div className="text-xs text-slate-300 truncate mb-2">{user?.email}</div>
        {confirmSignOut ? (
          <div className="flex items-center gap-2">
            <button
              className="btn-danger flex-1 justify-center"
              onClick={() => signOut()}
            >
              Confirm
            </button>
            <button className="btn-ghost" onClick={() => setConfirmSignOut(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="btn-ghost w-full justify-center"
            onClick={() => setConfirmSignOut(true)}
          >
            <LogOut size={12} /> Sign Out
          </button>
        )}
      </div>
    </aside>
  );
}
