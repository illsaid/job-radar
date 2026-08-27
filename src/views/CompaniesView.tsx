import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Company } from '@/types';
import { cn, timeAgo } from '@/lib/utils';
import { Plus, Edit2, Trash2, X, AlertTriangle } from 'lucide-react';

const ATS_TYPES = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'generic'];

export function CompaniesView() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [jobCounts, setJobCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('priority', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      setLoading(false);
      return;
    }

    setCompanies(data ?? []);

    const { data: jobData } = await supabase
      .from('jobs')
      .select('company_id')
      .eq('status', 'new');

    const counts = new Map<string, number>();
    (jobData ?? []).forEach((j: { company_id: string }) => {
      counts.set(j.company_id, (counts.get(j.company_id) ?? 0) + 1);
    });
    setJobCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (company: Company) => {
    await supabase.from('companies').update({ enabled: !company.enabled }).eq('id', company.id);
    load();
  };

  const handleDelete = async (company: Company) => {
    if (!confirm(`Remove ${company.name} from watchlist? This also deletes its tracked jobs.`)) return;
    await supabase.from('companies').delete().eq('id', company.id);
    load();
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm mono">LOADING...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-wide">COMPANY WATCHLIST</h2>
          <p className="text-2xs text-slate-500 mono uppercase tracking-wider mt-0.5">
            {companies.length} companies · {companies.filter((c) => c.enabled).length} active
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Plus size={14} /> Add Company
        </button>
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-2xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-2 font-medium">Company</th>
              <th className="text-left px-3 py-2 font-medium">Priority</th>
              <th className="text-left px-3 py-2 font-medium">ATS</th>
              <th className="text-left px-3 py-2 font-medium">Enabled</th>
              <th className="text-left px-3 py-2 font-medium">Last Scan</th>
              <th className="text-left px-3 py-2 font-medium">Last Success</th>
              <th className="text-right px-3 py-2 font-medium">Open Jobs</th>
              <th className="text-center px-3 py-2 font-medium">Errors</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-base-800 hover:bg-base-850/50 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="text-white font-medium">{c.name}</div>
                  {c.tags.length > 0 && (
                    <div className="flex gap-1 mt-0.5">
                      {c.tags.slice(0, 3).map((t) => (
                        <span key={t} className="text-2xs text-slate-500 bg-base-800 px-1.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      'label-tag',
                      c.priority === 1
                        ? 'bg-accent-cyan/10 text-accent-cyan'
                        : c.priority === 2
                        ? 'bg-base-750 text-slate-400'
                        : 'bg-base-800 text-slate-500'
                    )}
                  >
                    P{c.priority}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs text-slate-300 mono">{c.ats_type}</span>
                </td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => toggleEnabled(c)}
                    className={cn(
                      'relative w-9 h-5 rounded-full transition-colors',
                      c.enabled ? 'bg-accent-emerald/30' : 'bg-base-700'
                    )}
                  >
                    <div
                      className={cn(
                        'absolute top-0.5 w-4 h-4 rounded-full transition-transform',
                        c.enabled ? 'translate-x-4 bg-accent-emerald' : 'translate-x-0.5 bg-slate-500'
                      )}
                    />
                  </button>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-400 mono">{timeAgo(c.last_checked_at)}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400 mono">{timeAgo(c.last_success_at)}</td>
                <td className="px-3 py-2.5 text-right text-xs text-slate-300 mono">
                  {jobCounts.get(c.id) ?? 0}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {c.consecutive_failures > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-accent-amber">
                      <AlertTriangle size={11} /> {c.consecutive_failures}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost !p-1"
                      onClick={() => {
                        setEditing(c);
                        setShowForm(true);
                      }}
                    >
                      <Edit2 size={12} />
                    </button>
                    <button className="btn-danger !p-1" onClick={() => handleDelete(c)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <CompanyForm
          company={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CompanyForm({
  company,
  onClose,
  onSaved,
}: {
  company: Company | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(company?.name ?? '');
  const [careersUrl, setCareersUrl] = useState(company?.careers_url ?? '');
  const [atsType, setAtsType] = useState(company?.ats_type ?? 'greenhouse');
  const [atsIdentifier, setAtsIdentifier] = useState(company?.ats_identifier ?? '');
  const [priority, setPriority] = useState(company?.priority ?? 2);
  const [enabled, setEnabled] = useState(company?.enabled ?? true);
  const [tags, setTags] = useState(company?.tags.join(', ') ?? '');
  const [notes, setNotes] = useState(company?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name,
      careers_url: careersUrl,
      ats_type: atsType,
      ats_identifier: atsIdentifier || null,
      priority,
      enabled,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: notes || null,
    };

    const { error: saveError } = company
      ? await supabase.from('companies').update(payload).eq('id', company.id)
      : await supabase.from('companies').insert(payload);

    if (saveError) {
      setError(saveError.message);
      setSaving(false);
    } else {
      onSaved();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h3 className="text-sm font-semibold text-white">{company ? 'Edit Company' : 'Add Company'}</h3>
          <button className="btn-ghost !p-1" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">Company Name</label>
              <input className="input-field" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">Careers URL</label>
              <input className="input-field" required type="url" value={careersUrl} onChange={(e) => setCareersUrl(e.target.value)} />
            </div>
            <div>
              <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">ATS Type</label>
              <select className="input-field" value={atsType} onChange={(e) => setAtsType(e.target.value)}>
                {ATS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">ATS Identifier</label>
              <input className="input-field" value={atsIdentifier} onChange={(e) => setAtsIdentifier(e.target.value)} placeholder="board subdomain" />
            </div>
            <div>
              <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">Priority (1=high, 3=low)</label>
              <select className="input-field" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                <option value={1}>1 — High</option>
                <option value={2}>2 — Normal</option>
                <option value={3}>3 — Lower</option>
              </select>
            </div>
            <div>
              <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">Enabled</label>
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors mt-2',
                  enabled ? 'bg-accent-emerald/30' : 'bg-base-700'
                )}
              >
                <div
                  className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full transition-transform',
                    enabled ? 'translate-x-4 bg-accent-emerald' : 'translate-x-0.5 bg-slate-500'
                  )}
                />
              </button>
            </div>
          </div>
          <div>
            <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">Tags (comma-separated)</label>
            <input className="input-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="AI, media, production" />
          </div>
          <div>
            <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1 block">Notes</label>
            <textarea className="input-field min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <div className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 rounded px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : company ? 'Save Changes' : 'Add Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
