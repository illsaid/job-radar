import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { JobWithRelations, Company, JobScore, Application } from '@/types';
import { cn, timeAgo, scoreColor } from '@/lib/utils';
import { FileText, ExternalLink } from 'lucide-react';

const APPLICATION_STATUSES = [
  'NOT_REVIEWED',
  'REVIEWING',
  'APPLY',
  'APPLIED',
  'INTERVIEW',
  'REJECTED',
  'WITHDRAWN',
  'PASS',
];

interface AppliedViewProps {
  onOpenJob: (job: JobWithRelations) => void;
}

export function AppliedView({ onOpenJob }: AppliedViewProps) {
  const [applications, setApplications] = useState<(Application & { job?: JobWithRelations })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: appData, error } = await supabase
      .from('applications')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error || !appData) {
      setLoading(false);
      return;
    }

    const jobIds = appData.map((a) => a.job_id);
    const jobMap = new Map<string, JobWithRelations>();
    const companyMap = new Map<string, Company>();
    const scoreMap = new Map<string, JobScore>();

    if (jobIds.length > 0) {
      const { data: jobs } = await supabase.from('jobs').select('*').in('id', jobIds);
      (jobs ?? []).forEach((j: JobWithRelations) => jobMap.set(j.id, j));

      const companyIds = (jobs ?? []).map((j: JobWithRelations) => j.company_id);
      if (companyIds.length > 0) {
        const { data: companies } = await supabase.from('companies').select('*').in('id', companyIds);
        (companies ?? []).forEach((c: Company) => companyMap.set(c.id, c));
      }

      const { data: scores } = await supabase
        .from('job_scores')
        .select('*')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false });
      (scores ?? []).forEach((s: JobScore) => {
        if (!scoreMap.has(s.job_id)) scoreMap.set(s.job_id, s);
      });
    }

    const enriched = appData.map((a) => {
      const job = jobMap.get(a.job_id);
      if (job) {
        job.company = companyMap.get(job.company_id);
        job.latest_score = scoreMap.get(a.job_id) ?? null;
      }
      return { ...a, job };
    });

    setApplications(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (appId: string, status: string) => {
    const updates: Record<string, unknown> = { status };
    if (status === 'APPLIED') updates.applied_at = new Date().toISOString();
    await supabase.from('applications').update(updates).eq('id', appId);
    load();
  };

  const updateNotes = async (appId: string, notes: string) => {
    await supabase.from('applications').update({ notes }).eq('id', appId);
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm mono">LOADING...</div>;
  }

  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      NOT_REVIEWED: 'bg-base-750 text-slate-400',
      REVIEWING: 'bg-accent-cyan/10 text-accent-cyan',
      APPLY: 'bg-accent-amber/10 text-accent-amber',
      APPLIED: 'bg-accent-cyan/10 text-accent-cyan',
      INTERVIEW: 'bg-accent-emerald/10 text-accent-emerald',
      REJECTED: 'bg-accent-red/10 text-accent-red',
      WITHDRAWN: 'bg-base-800 text-slate-500',
      PASS: 'bg-base-800 text-slate-500',
    };
    return colors[status] ?? 'bg-base-750 text-slate-400';
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-white tracking-wide">APPLICATION TRACKING</h2>
        <p className="text-2xs text-slate-500 mono uppercase tracking-wider mt-0.5">
          {applications.length} tracked · manual status only
        </p>
      </div>

      {applications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-slate-400 text-sm mb-1">No applications tracked</div>
          <div className="text-slate-600 text-xs">
            Mark jobs as APPLY or APPLIED from the Radar to start tracking here.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {applications.map((app) => (
            <div key={app.id} className="panel p-4">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-12 text-center">
                  {app.job?.latest_score && (
                    <>
                      <div className={cn('text-xl font-bold mono', scoreColor(app.job.latest_score.total_score))}>
                        {app.job.latest_score.total_score}
                      </div>
                    </>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3
                    className="text-sm font-semibold text-white truncate cursor-pointer hover:text-accent-cyan"
                    onClick={() => app.job && onOpenJob(app.job)}
                  >
                    {app.job?.title ?? 'Unknown job'}
                  </h3>
                  <div className="text-xs text-slate-400">{app.job?.company?.name ?? '—'}</div>
                  <div className="text-2xs text-slate-500 mt-0.5">
                    Updated {timeAgo(app.updated_at)}
                    {app.applied_at && ` · Applied ${timeAgo(app.applied_at)}`}
                  </div>

                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <select
                      value={app.status}
                      onChange={(e) => updateStatus(app.id, e.target.value)}
                      className={cn('text-xs rounded border border-base-700 bg-base-850 px-2 py-1 text-white focus:outline-none')}
                    >
                      {APPLICATION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                    <span className={cn('label-tag', statusColor(app.status))}>
                      {app.status.replace(/_/g, ' ')}
                    </span>
                    {app.job?.job_url && (
                      <a href={app.job.job_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                        <ExternalLink size={11} /> Posting
                      </a>
                    )}
                    <button className="btn-ghost" onClick={() => app.job && onOpenJob(app.job)}>
                      <FileText size={11} /> Packet
                    </button>
                  </div>

                  <textarea
                    className="input-field mt-3 min-h-[40px] text-xs"
                    placeholder="Notes..."
                    defaultValue={app.notes ?? ''}
                    onBlur={(e) => updateNotes(app.id, e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
