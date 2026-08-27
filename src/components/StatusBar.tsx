import { Activity, Building2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/utils';

interface StatusBarProps {
  lastScan: string | null;
  companiesMonitored: number;
  jobsChecked: number;
  newJobs: number;
  alerts: number;
  systemHealth: 'healthy' | 'degraded' | 'down' | 'unknown';
}

export function StatusBar({
  lastScan,
  companiesMonitored,
  jobsChecked,
  newJobs,
  alerts,
  systemHealth,
}: StatusBarProps) {
  const healthConfig = {
    healthy: { color: 'bg-accent-emerald', label: 'HEALTHY', text: 'text-accent-emerald' },
    degraded: { color: 'bg-accent-amber', label: 'DEGRADED', text: 'text-accent-amber' },
    down: { color: 'bg-accent-red', label: 'DOWN', text: 'text-accent-red' },
    unknown: { color: 'bg-slate-500', label: 'UNKNOWN', text: 'text-slate-400' },
  }[systemHealth];

  return (
    <div className="h-12 bg-base-900 border-b border-base-700 flex items-center px-4 gap-6 shrink-0">
      <div className="flex items-center gap-2">
        <div className="relative">
          <div className="status-dot bg-accent-cyan" />
          <div className="absolute inset-0 rounded-full bg-accent-cyan animate-ping opacity-30" />
        </div>
        <span className="text-sm font-bold tracking-widest text-white">JOB RADAR</span>
      </div>

      <div className="h-5 w-px bg-base-700" />

      <div className="flex items-center gap-1.5 text-xs">
        <Clock size={13} className="text-slate-500" />
        <span className="text-slate-500">Last scan</span>
        <span className="text-white mono">{timeAgo(lastScan)}</span>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <Building2 size={13} className="text-slate-500" />
        <span className="text-white mono">{companiesMonitored}</span>
        <span className="text-slate-500">companies</span>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <Activity size={13} className="text-slate-500" />
        <span className="text-white mono">{jobsChecked}</span>
        <span className="text-slate-500">jobs checked</span>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <CheckCircle2 size={13} className="text-slate-500" />
        <span className="mono font-semibold text-accent-cyan">{newJobs}</span>
        <span className="text-slate-500">new</span>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <AlertTriangle size={13} className="text-slate-500" />
        <span className="mono font-semibold text-accent-amber">{alerts}</span>
        <span className="text-slate-500">alerts</span>
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <div className={cn('status-dot', healthConfig.color)} />
        <span className={cn('mono font-semibold tracking-wider', healthConfig.text)}>
          {healthConfig.label}
        </span>
      </div>
    </div>
  );
}
