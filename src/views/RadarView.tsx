import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { JobWithRelations, Company, JobScore, Application } from '@/types';
import { getThreshold } from '@/config/thresholds';
import { cn, timeAgo, scoreColor, scoreBgColor } from '@/lib/utils';
import { ExternalLink, FileText, Check, X, MapPin, Clock } from 'lucide-react';

interface RadarViewProps {
  onOpenJob: (job: JobWithRelations) => void;
}

export function RadarView({ onOpenJob }: RadarViewProps) {
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [companies, setCompanies] = useState<Map<string, Company>>(new Map());
  const [filteredCount, setFilteredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    // Fetch jobs that are NOT filtered — only new + scored (candidate-relevant)
    const { data: jobData, error: jobError } = await supabase
      .from('jobs')
      .select('*')
      .in('status', ['new', 'scored'])
      .order('first_seen_at', { ascending: false })
      .limit(50);

    if (jobError) {
      setError(jobError.message);
      setLoading(false);
      return;
    }

    setError(null);

    // Get count of filtered jobs for the secondary counter
    const { count: fCount } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'filtered');
    setFilteredCount(fCount ?? 0);

    const { data: companyData } = await supabase.from('companies').select('*');
    const companyMap = new Map<string, Company>();
    (companyData ?? []).forEach((c: Company) => companyMap.set(c.id, c));

    // Fetch latest scores for these jobs
    const jobIds = (jobData ?? []).map((j) => j.id);
    const scoreMap = new Map<string, JobScore>();
    const appMap = new Map<string, Application>();

    if (jobIds.length > 0) {
      const { data: scoreData } = await supabase
        .from('job_scores')
        .select('*')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false });

      (scoreData ?? []).forEach((s: JobScore) => {
        if (!scoreMap.has(s.job_id)) scoreMap.set(s.job_id, s);
      });

      const { data: appData } = await supabase
        .from('applications')
        .select('*')
        .in('job_id', jobIds);
      (appData ?? []).forEach((a: Application) => appMap.set(a.job_id, a));
    }

    const enriched: JobWithRelations[] = (jobData ?? []).map((j) => ({
      ...j,
      company: companyMap.get(j.company_id),
      latest_score: scoreMap.get(j.id) ?? null,
      application: appMap.get(j.id) ?? null,
    }));

    setJobs(enriched);
    setCompanies(companyMap);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();

    const refreshInterval = window.setInterval(loadData, 60_000);
    return () => window.clearInterval(refreshInterval);
  }, [loadData]);

  const updateApplicationStatus = async (jobId: string, status: string) => {
    const existing = jobs.find((j) => j.id === jobId)?.application;
    if (existing) {
      await supabase.from('applications').update({ status }).eq('job_id', jobId);
    } else {
      await supabase.from('applications').insert({ job_id: jobId, status });
    }
    loadData();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-slate-500 text-sm mono">SCANNING...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-accent-red text-sm mb-2">Feed Error</div>
          <div className="text-slate-500 text-xs mono">{error}</div>
        </div>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full border-2 border-base-700 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
          </div>
          <div className="text-slate-400 text-sm mb-1">No jobs detected</div>
          <div className="text-slate-600 text-xs">
            The radar is monitoring {companies.size} companies. New postings will appear here as they're detected.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-wide">RECENT DETECTIONS</h2>
          <p className="text-2xs text-slate-500 mono uppercase tracking-wider mt-0.5">
            {jobs.length} relevant · {filteredCount} filtered · latest first
          </p>
          {lastUpdated && (
            <p className="text-2xs text-slate-600 mono uppercase tracking-wider mt-0.5">
              Last updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {jobs.map((job) => (
          <RadarCard key={job.id} job={job} onOpen={() => onOpenJob(job)} onMarkApply={() => updateApplicationStatus(job.id, 'APPLY')} onPass={() => updateApplicationStatus(job.id, 'PASS')} />
        ))}
      </div>
    </div>
  );
}

function RadarCard({
  job,
  onOpen,
  onMarkApply,
  onPass,
}: {
  job: JobWithRelations;
  onOpen: () => void;
  onMarkApply: () => void;
  onPass: () => void;
}) {
  const score = job.latest_score?.total_score;
  const threshold = score !== undefined ? getThreshold(score) : null;
  const companyName = job.company?.name ?? 'Unknown';
  const components = job.latest_score?.component_scores_json;

  return (
    <div
      className={cn(
        'panel p-4 border-l-2 transition-all duration-150 hover:border-base-600 cursor-pointer',
        score !== undefined ? scoreBgColor(score) : 'border-l-base-600'
      )}
      onClick={onOpen}
    >
      <div className="flex items-start gap-4">
        {/* Score block */}
        <div className="shrink-0 w-16 text-center">
          {score !== undefined ? (
            <>
              <div className={cn('text-3xl font-bold mono', scoreColor(score))}>{score}</div>
              <div className={cn('text-2xs font-semibold tracking-wider mt-0.5', scoreColor(score))}>
                {threshold?.label.split(' ').slice(0, 2).join(' ')}
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl font-bold mono text-slate-600">—</div>
              <div className="text-2xs text-slate-600 tracking-wider mt-0.5">UNSCORED</div>
            </>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">{job.title}</h3>
              <div className="text-xs text-slate-400 mt-0.5">{companyName}</div>
              <div className="flex items-center gap-3 mt-1 text-2xs text-slate-500">
                {job.location_text && (
                  <span className="flex items-center gap-1">
                    <MapPin size={10} /> {job.location_text}
                  </span>
                )}
                {job.remote_status && (
                  <span className="text-accent-cyan/60">{job.remote_status}</span>
                )}
                <span className="flex items-center gap-1">
                  <Clock size={10} /> Detected {timeAgo(job.first_seen_at)}
                </span>
                {job.source_published_at && (
                  <span>Published {timeAgo(job.source_published_at)}</span>
                )}
              </div>
            </div>

            {job.latest_score && (
              <div className="shrink-0 hidden lg:flex gap-1.5">
                {components && (
                  <>
                    <ComponentBar label="PROD" value={components.production_operations} max={25} />
                    <ComponentBar label="AI" value={components.ai_workflow} max={20} />
                    <ComponentBar label="MEDIA" value={components.media_domain} max={15} />
                    <ComponentBar label="LEAD" value={components.leadership} max={15} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
            <button className="btn-ghost" onClick={onOpen}>
              <FileText size={12} /> VIEW PACKET
            </button>
            {job.job_url && (
              <a href={job.job_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                <ExternalLink size={12} /> OPEN POSTING
              </a>
            )}
            <button className="btn-ghost" onClick={onMarkApply}>
              <Check size={12} /> MARK APPLY
            </button>
            <button className="btn-ghost" onClick={onPass}>
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
}

function ComponentBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  const color = pct >= 80 ? 'bg-accent-emerald' : pct >= 60 ? 'bg-accent-cyan' : pct >= 40 ? 'bg-accent-amber' : 'bg-slate-600';

  return (
    <div className="flex flex-col items-center gap-0.5 w-12">
      <div className="text-2xs mono text-slate-400">
        {value}/{max}
      </div>
      <div className="w-full h-1 rounded-full bg-base-800 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-2xs text-slate-600 uppercase tracking-wider">{label}</div>
    </div>
  );
}
