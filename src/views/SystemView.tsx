import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { SystemRun } from '@/types';
import { cn, timeAgo } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, Clock, Activity, Building2, Bell, Zap, RefreshCw } from 'lucide-react';

const PIPELINE_STAGES = [
  { name: 'poll-jobs', label: 'Poll Feeds', description: 'Fetch jobs from enabled companies' },
  { name: 'score-jobs', label: 'Score Fit', description: 'AI scoring against candidate profile' },
  { name: 'generate-packets', label: 'Generate Packets', description: 'Application packets for 75+' },
  { name: 'send-alerts', label: 'Send Alerts', description: 'Email alerts via Resend' },
];

export function SystemView() {
  const [runs, setRuns] = useState<SystemRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('system_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);

    if (error || !data) {
      setLoading(false);
      return;
    }

    setRuns(data as SystemRun[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const latest = runs[0];
  const allFailures = runs.flatMap((r) =>
    (r.failures_json ?? []).map((f) => ({ ...f, runStarted: r.started_at }))
  );

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm mono">LOADING...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-white tracking-wide">SYSTEM STATUS</h2>
        <p className="text-2xs text-slate-500 mono uppercase tracking-wider mt-0.5">
          Operational monitoring · last 20 runs
        </p>
      </div>

      {/* Pipeline stages */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-white tracking-wide mb-2">PIPELINE</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {PIPELINE_STAGES.map((stage) => (
            <div key={stage.name} className="panel p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={11} className="text-accent-cyan" />
                <span className="text-xs text-white font-medium">{stage.label}</span>
              </div>
              <div className="text-2xs text-slate-500 mb-2">{stage.description}</div>
              <button
                className="btn-ghost w-full justify-center !text-2xs"
                disabled={triggering === stage.name}
                onClick={async () => {
                  setTriggering(stage.name);
                  try {
                    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${stage.name}`;
                    // Use the user's session JWT for manual triggers (never the cron secret)
                    const { data: { session } } = await supabase.auth.getSession();
                    await fetch(apiUrl, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session?.access_token ?? ''}`,
                      },
                      body: '{}',
                    });
                    // Give the edge function a moment to complete before refreshing
                    setTimeout(() => load(), 2000);
                  } catch {
                    // Non-fatal
                  }
                  setTriggering(null);
                }}
              >
                {triggering === stage.name ? (
                  <><RefreshCw size={10} className="animate-spin" /> Running...</>
                ) : (
                  <><RefreshCw size={10} /> Trigger</>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Latest run summary */}
      {latest ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
          <MetricCard icon={Clock} label="Last Run" value={timeAgo(latest.started_at)} sub={latest.duration_ms ? `${(latest.duration_ms / 1000).toFixed(1)}s` : '—'} />
          <MetricCard icon={Building2} label="Companies" value={String(latest.companies_checked)} />
          <MetricCard icon={Activity} label="Jobs Fetched" value={String(latest.jobs_seen)} />
          <MetricCard icon={CheckCircle2} label="New Jobs" value={String(latest.new_jobs)} accent="cyan" />
          <MetricCard icon={Activity} label="Scored" value={String(latest.jobs_scored)} />
          <MetricCard icon={Bell} label="Alerts" value={String(latest.alerts_sent)} accent="amber" />
          <MetricCard
            icon={AlertTriangle}
            label="Failures"
            value={String((latest.failures_json ?? []).length)}
            accent={(latest.failures_json ?? []).length > 0 ? 'red' : undefined}
          />
        </div>
      ) : (
        <div className="panel p-8 text-center mb-4">
          <div className="text-slate-400 text-sm mb-1">No system runs recorded</div>
          <div className="text-slate-600 text-xs">
            Runs will appear here once the scheduled polling edge function is deployed and cron is configured.
          </div>
        </div>
      )}

      {/* Recent failures */}
      {allFailures.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-white tracking-wide mb-2">RECENT FAILURES</h3>
          <div className="panel divide-y divide-base-800">
            {allFailures.slice(0, 10).map((f, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                <AlertTriangle size={14} className="text-accent-amber shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white">{f.company ?? 'Unknown company'}</div>
                  <div className="text-2xs text-slate-500 mono mt-0.5 break-all">{f.error}</div>
                </div>
                <div className="text-2xs text-slate-600 mono shrink-0">{timeAgo(f.runStarted)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run history */}
      <h3 className="text-xs font-semibold text-white tracking-wide mb-2">RUN HISTORY</h3>
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-2xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-2 font-medium">Started</th>
              <th className="text-left px-3 py-2 font-medium">Duration</th>
              <th className="text-right px-3 py-2 font-medium">Companies</th>
              <th className="text-right px-3 py-2 font-medium">Jobs</th>
              <th className="text-right px-3 py-2 font-medium">New</th>
              <th className="text-right px-3 py-2 font-medium">Scored</th>
              <th className="text-right px-3 py-2 font-medium">Alerts</th>
              <th className="text-center px-4 py-2 font-medium">Failures</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-base-800 hover:bg-base-850/50">
                <td className="px-4 py-2 text-xs text-slate-300 mono">{timeAgo(r.started_at)}</td>
                <td className="px-3 py-2 text-xs text-slate-400 mono">
                  {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-300 mono text-right">{r.companies_checked}</td>
                <td className="px-3 py-2 text-xs text-slate-300 mono text-right">{r.jobs_seen}</td>
                <td className="px-3 py-2 text-xs text-accent-cyan mono text-right">{r.new_jobs}</td>
                <td className="px-3 py-2 text-xs text-slate-300 mono text-right">{r.jobs_scored}</td>
                <td className="px-3 py-2 text-xs text-accent-amber mono text-right">{r.alerts_sent}</td>
                <td className="px-4 py-2 text-center">
                  {(r.failures_json ?? []).length > 0 ? (
                    <span className="text-xs text-accent-amber mono">{(r.failures_json ?? []).length}</span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub?: string;
  accent?: 'cyan' | 'amber' | 'red';
}) {
  const accentColor =
    accent === 'cyan' ? 'text-accent-cyan' : accent === 'amber' ? 'text-accent-amber' : accent === 'red' ? 'text-accent-red' : 'text-white';

  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5 text-2xs text-slate-500 uppercase tracking-wider mb-1">
        <Icon size={11} /> {label}
      </div>
      <div className={cn('text-lg font-bold mono', accentColor)}>{value}</div>
      {sub && <div className="text-2xs text-slate-600 mono">{sub}</div>}
    </div>
  );
}
