import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { JobWithRelations, ApplicationPacket, JobScore } from '@/types';
import { getThreshold } from '@/config/thresholds';
import { cn, scoreColor, timeAgo, formatDate } from '@/lib/utils';
import { X, ExternalLink, FileText, MapPin, Clock, Building2, DollarSign, Calendar } from 'lucide-react';

interface JobDetailProps {
  job: JobWithRelations;
  onClose: () => void;
}

export function JobDetail({ job, onClose }: JobDetailProps) {
  const [packet, setPacket] = useState<ApplicationPacket | null>(null);
  const [score, setScore] = useState<JobScore | null>(job.latest_score ?? null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: packetData } = await supabase
        .from('application_packets')
        .select('*')
        .eq('job_id', job.id)
        .maybeSingle();

      if (packetData) setPacket(packetData as ApplicationPacket);

      if (!score) {
        const { data: scoreData } = await supabase
          .from('job_scores')
          .select('*')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (scoreData) setScore(scoreData as JobScore);
      }

      setLoading(false);
    };
    load();
  }, [job.id]);

  const threshold = score ? getThreshold(score.total_score) : null;
  const components = score?.component_scores_json;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-base-900 border-l border-base-700 h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-base-900 border-b border-base-700 px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {score && (
              <div className={cn('text-2xl font-bold mono', scoreColor(score.total_score))}>
                {score.total_score}
              </div>
            )}
            <div>
              <h2 className="text-sm font-semibold text-white">{job.title}</h2>
              <div className="text-xs text-slate-400">{job.company?.name ?? '—'}</div>
            </div>
          </div>
          <button className="btn-ghost !p-1" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Snapshot */}
          <section>
            <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Snapshot</h3>
            <div className="panel p-4 grid grid-cols-2 gap-3 text-xs">
              <DetailRow icon={Building2} label="Company" value={job.company?.name ?? '—'} />
              <DetailRow icon={FileText} label="Role" value={job.title} />
              <DetailRow icon={MapPin} label="Location" value={job.location_text ?? '—'} />
              <DetailRow icon={Clock} label="Remote" value={job.remote_status ?? '—'} />
              {job.compensation_min && (
                <DetailRow
                  icon={DollarSign}
                  label="Compensation"
                  value={`${job.compensation_currency} ${job.compensation_min.toLocaleString()}${job.compensation_max ? `–${job.compensation_max.toLocaleString()}` : ''}`}
                />
              )}
              <DetailRow icon={Calendar} label="Published" value={job.source_published_at ? formatDate(job.source_published_at) : '—'} />
              <DetailRow icon={Clock} label="First seen" value={timeAgo(job.first_seen_at)} />
              {threshold && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Fit:</span>
                  <span className={cn('font-semibold', scoreColor(score?.total_score ?? 0))}>
                    {threshold.label}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Score breakdown */}
          {score && components && (
            <section>
              <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Score Breakdown</h3>
              <div className="panel p-4 space-y-2">
                <ScoreBar label="Production / Operations" value={components.production_operations} max={25} />
                <ScoreBar label="AI / Workflow Transformation" value={components.ai_workflow} max={20} />
                <ScoreBar label="Media / Entertainment Domain" value={components.media_domain} max={15} />
                <ScoreBar label="Leadership / Cross-functional" value={components.leadership} max={15} />
                <ScoreBar label="Experience Transferability" value={components.transferability} max={10} />
                <ScoreBar label="Seniority Match" value={components.seniority} max={10} />
                <ScoreBar label="Location / Work Arrangement" value={components.location} max={5} />
                <div className="pt-2 border-t border-base-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Total</span>
                  <span className={cn('text-lg font-bold mono', scoreColor(score.total_score))}>
                    {score.total_score}/100
                  </span>
                </div>
                <div className="text-2xs text-slate-500 mono">
                  Recommendation: {score.recommendation} · Confidence: {score.confidence} · Model: {score.model_used ?? '—'}
                </div>
              </div>
            </section>
          )}

          {/* Why it fits */}
          {score && score.strengths_json.length > 0 && (
            <section>
              <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Why It Fits</h3>
              <div className="panel p-4 space-y-1.5">
                {score.strengths_json.map((s, i) => (
                  <div key={i} className="text-xs text-slate-300 flex items-start gap-2">
                    <span className="text-accent-emerald shrink-0">+</span>
                    {s}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Gaps */}
          {score && score.gaps_json.length > 0 && (
            <section>
              <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Gaps / Risks</h3>
              <div className="panel p-4 space-y-1.5">
                {score.gaps_json.map((g, i) => (
                  <div key={i} className="text-xs text-slate-300 flex items-start gap-2">
                    <span className="text-accent-amber shrink-0">!</span>
                    {g}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Penalties */}
          {score && score.penalties_json.length > 0 && (
            <section>
              <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Penalties</h3>
              <div className="panel p-4 space-y-1.5">
                {score.penalties_json.map((p, i) => (
                  <div key={i} className="text-xs text-slate-300 flex items-start gap-2">
                    <span className="text-accent-red shrink-0">-</span>
                    {p}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Hiring manager thesis */}
          {score?.hiring_manager_thesis && (
            <section>
              <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Hiring Manager Thesis</h3>
              <div className="panel p-4">
                <p className="text-xs text-slate-300 leading-relaxed">{score.hiring_manager_thesis}</p>
              </div>
            </section>
          )}

          {/* Job description */}
          <section>
            <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Job Description</h3>
            <div className="panel p-4 max-h-96 overflow-y-auto">
              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-sans leading-relaxed">
                {job.description_text ?? 'No description available.'}
              </pre>
            </div>
          </section>

          {/* Application packet */}
          {packet && packet.packet_markdown && (
            <section>
              <h3 className="text-2xs text-slate-500 uppercase tracking-wider mb-2">Application Packet</h3>
              <div className="panel p-4">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-sans leading-relaxed">
                  {packet.packet_markdown}
                </pre>
              </div>
            </section>
          )}

          {!loading && !packet && score && score.total_score >= 75 && (
            <section>
              <div className="panel p-4 text-center">
                <div className="text-xs text-slate-400 mb-1">Application packet not yet generated</div>
                <div className="text-2xs text-slate-600">Packets are generated for scores 75+ during the scoring run.</div>
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-base-700">
            {job.apply_url && (
              <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <ExternalLink size={13} /> OPEN OFFICIAL APPLICATION
              </a>
            )}
            {job.job_url && !job.apply_url && (
              <a href={job.job_url} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <ExternalLink size={13} /> OPEN POSTING
              </a>
            )}
            <div className="text-2xs text-slate-600 ml-auto mono">
              Job Radar never submits applications automatically
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className="text-slate-500 shrink-0" />
      <div>
        <div className="text-2xs text-slate-500 uppercase tracking-wider">{label}</div>
        <div className="text-white">{value}</div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  const color = pct >= 80 ? 'bg-accent-emerald' : pct >= 60 ? 'bg-accent-cyan' : pct >= 40 ? 'bg-accent-amber' : 'bg-slate-600';

  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-slate-400 w-44 shrink-0">{label}</div>
      <div className="flex-1 h-1.5 rounded-full bg-base-800 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-2xs text-slate-400 mono w-12 text-right shrink-0">
        {value}/{max}
      </div>
    </div>
  );
}
