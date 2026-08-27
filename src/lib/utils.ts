export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function timeAgo(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function timeShort(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function scoreColor(score: number): string {
  if (score >= 90) return 'text-accent-emerald';
  if (score >= 82) return 'text-accent-cyan';
  if (score >= 75) return 'text-accent-amber';
  if (score >= 65) return 'text-slate-400';
  return 'text-slate-600';
}

export function scoreBgColor(score: number): string {
  if (score >= 90) return 'bg-accent-emerald/10 border-accent-emerald/30';
  if (score >= 82) return 'bg-accent-cyan/10 border-accent-cyan/30';
  if (score >= 75) return 'bg-accent-amber/10 border-accent-amber/30';
  if (score >= 65) return 'bg-base-800 border-base-600';
  return 'bg-base-850 border-base-700';
}
