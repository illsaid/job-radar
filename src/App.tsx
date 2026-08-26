import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { SignIn } from '@/components/SignIn';
import { Sidebar, type ViewKey } from '@/components/Sidebar';
import { StatusBar } from '@/components/StatusBar';
import { RadarView } from '@/views/RadarView';
import { FilteredJobsView } from '@/views/FilteredJobsView';
import { AppliedView } from '@/views/AppliedView';
import { CompaniesView } from '@/views/CompaniesView';
import { SystemView } from '@/views/SystemView';
import { JobDetail } from '@/components/JobDetail';
import type { JobWithRelations } from '@/types';

function Dashboard() {
  const [view, setView] = useState<ViewKey>('radar');
  const [selectedJob, setSelectedJob] = useState<JobWithRelations | null>(null);

  // Status bar data
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [companiesMonitored, setCompaniesMonitored] = useState(0);
  const [jobsChecked, setJobsChecked] = useState(0);
  const [newJobs, setNewJobs] = useState(0);
  const [alerts, setAlerts] = useState(0);
  const [systemHealth, setSystemHealth] = useState<'healthy' | 'degraded' | 'down' | 'unknown'>('unknown');

  const loadStatus = useCallback(async () => {
    const { count: companyCount } = await supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', true);
    setCompaniesMonitored(companyCount ?? 0);

    const { count: jobCount } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true });
    setJobsChecked(jobCount ?? 0);

    const { count: newCount } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new');
    setNewJobs(newCount ?? 0);

    const { count: alertCount } = await supabase
      .from('alerts')
      .select('*', { count: 'exact', head: true });
    setAlerts(alertCount ?? 0);

    const { data: latestRun } = await supabase
      .from('system_runs')
      .select('started_at, failures_json, completed_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRun) {
      setLastScan(latestRun.started_at);
      const failures = (latestRun.failures_json as unknown[]) ?? [];
      if (latestRun.completed_at) {
        setSystemHealth(failures.length > 0 ? 'degraded' : 'healthy');
      } else {
        setSystemHealth('unknown');
      }
    } else {
      setLastScan(null);
      setSystemHealth('unknown');
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const handleNavigate = (v: ViewKey) => {
    setView(v);
    setSelectedJob(null);
  };

  return (
    <div className="h-screen flex bg-base-950">
      <Sidebar active={view} onNavigate={handleNavigate} />
      <div className="flex-1 flex flex-col min-w-0">
        <StatusBar
          lastScan={lastScan}
          companiesMonitored={companiesMonitored}
          jobsChecked={jobsChecked}
          newJobs={newJobs}
          alerts={alerts}
          systemHealth={systemHealth}
        />
        <div className="flex-1 flex min-h-0">
          {view === 'radar' && <RadarView onOpenJob={setSelectedJob} />}
          {view === 'strong' && (
            <FilteredJobsView
              minScore={82}
              maxScore={100}
              title="STRONG MATCHES"
              subtitle="Scores 82+ · apply-now and exceptional"
              onOpenJob={setSelectedJob}
            />
          )}
          {view === 'watch' && (
            <FilteredJobsView
              minScore={65}
              maxScore={81}
              title="WATCH"
              subtitle="Scores 65–81 · strong review and watch"
              onOpenJob={setSelectedJob}
            />
          )}
          {view === 'applied' && <AppliedView onOpenJob={setSelectedJob} />}
          {view === 'companies' && <CompaniesView />}
          {view === 'system' && <SystemView />}
        </div>
      </div>

      {selectedJob && <JobDetail job={selectedJob} onClose={() => setSelectedJob(null)} />}
    </div>
  );
}

function AppInner() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-base-950">
        <div className="text-slate-500 text-sm mono animate-pulse">INITIALIZING...</div>
      </div>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
