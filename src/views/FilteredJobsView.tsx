import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { JobWithRelations, Company, JobScore, Application } from '@/types';
import { getThreshold } from '@/config/thresholds';
import { cn, timeAgo, scoreColor, scoreBgColor } from '@/lib/utils';
import { ExternalLink, FileText, Check, X, MapPin, Clock } from 'lucide-react';

interface FilteredJobsViewProps {
  minScore: number;
  maxScore: number;
  title: string;
  subtitle: string;
  onOpenJob: (job: JobWithRelations) => void;
}

export function FilteredJobsView({ minScore, maxScore, title, subtitle, onOpenJob }: FilteredJobsViewProps) {
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Get scores in range, then fetch jobs
    const { data: scoreData, error: scoreError } = await supabase
      .from('job_scores')
      .select('*, job_id')
      .gte('total_score', minScore)
      .lte('total_score', maxScore)
      .order('created_at', { ascending: false });

    if (scoreError || !scoreData) {
      setLoading(false);
      return;
    }

    // Deduplicate by job_id — keep latest score
    const scoreMap = new Map<string, JobScore>();
    (scoreData as JobScore[]).forEach((s) => {
      if (!scoreMap.has(s.job_id)) scoreMap.set(s.job_id, s);
    });

    const jobIds = Array.from(scoreMap.keys());
    if (jobIds.length === 0) {
      setJobs([]);
      setLoading(false);
      return;
    }

    const { data: jobData } = await supabase.from('jobs').select('*').in('id', jobIds);
    const companyIds = (jobData ?? []).map((j: JobWithRelations) => j.company_id);

    const { data: companyData } = await supabase.from('companies').select('*').in('id', companyIds);
    const companyMap = new Map<string, Company>();
    (companyData ?? []).forEach((c: Company) => companyMap.set(c.id, c));

    const { data: appData } = await supabase.from('applications').select('*').in('job_id', jobIds);
    const appMap = new Map<string, Application>();
    (appData ?? []).forEach((a: Application) => appMap.set(a.job_id, a));

    const enriched: JobWithRelations[] = (jobData ?? []).map((j: JobWithRelations) => ({
      ...j,
      company: companyMap.get(j.company_id),
      latest_score: scoreMap.get(j.id) ?? null,
      application: appMap.get(j.id) ?? null,
    }));

    // Sort by score descending
    enriched.sort((a, b) => (b.latest_score?.total_score ?? 0) - (a.latest_score?.total_score ?? 0));
    setJobs(enriched);
    setLoading(false);
  }, [minScore, maxScore]);

  useEffect(() => {
    load();
  }, [load]);

  const updateApplicationStatus = async (jobId: string, status: string) => {
    const existing = jobs.find((j) => j.id === jobId)?.application;
    if (existing) {
      await supabase.from('applications').update({ status }).eq('job_id', jobId);
    } else {
      await supabase.from('applications').insert({ job_id: jobId, status });
    }
    load();
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm mono">LOADING...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-white tracking-wide">{title}</h2>
        <p className="text-2xs text-slate-500 mono uppercase tracking-wider mt-0.5">{subtitle}</p>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-slate-400 text-sm mb-1">No jobs in this range</div>
          <div className="text-slate-600 text-xs">Scores between {minScore}–{maxScore} will appear here.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const score = job.latest_score?.total_score ?? 0;
            const threshold = getThreshold(score);
            return (
              <div
                key={job.id}
                className={cn('panel p-4 border-l-2 cursor-pointer transition-all hover:border-base-600', scoreBgColor(score))}
                onClick={() => onOpenJob(job)}
              >
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-16 text-center">
                    <div className={cn('text-3xl font-bold mono', scoreColor(score))}>{score}</div>
                    <div className={cn('text-2xs font-semibold tracking-wider mt-0.5', scoreColor(score))}>
                      {threshold.label.split(' ').slice(0, 2).join(' ')}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{job.title}</h3>
                    <div className="text-xs text-slate-400 mt-0.5">{job.company?.name ?? '—'}</div>
                    <div className="flex items-center gap-3 mt-1 text-2xs text-slate-500">
                      {job.location_text && (
                        <span className="flex items-center gap-1">
                          <MapPin size={10} /> {job.location_text}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {timeAgo(job.first_seen_at)}
                      </span>
                    </div>

                    {job.latest_score?.strengths_json && job.latest_score.strengths_json.length > 0 && (
                      <div className="mt-2 text-2xs text-slate-400 line-clamp-2">
                        {job.latest_score.strengths_json[0]}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost" onClick={() => onOpenJob(job)}>
                        <FileText size={12} /> VIEW PACKET
                      </button>
                      {job.job_url && (
                        <a href={job.job_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                          <ExternalLink size={12} /> OPEN
                        </a>
                      )}
                      <button className="btn-ghost" onClick={() => updateApplicationStatus(job.id, 'APPLY')}>
                        <Check size={12} /> APPLY
                      </button>
                      <button className="btn-ghost" onClick={() => updateApplicationStatus(job.id, 'PASS')}>
                        <X size={12} /> PASS
                      </button>
                      {job.application && (
                        <span className="label-tag bg-base-750 text-slate-400 ml-auto">
                          {job.application.status.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
