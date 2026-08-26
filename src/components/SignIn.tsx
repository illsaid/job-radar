import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Mode = 'signin' | 'signup';

export function SignIn() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);

    if (mode === 'signin') {
      const { error: signInError } = await signIn(email, password);
      if (signInError) {
        setError(signInError);
        setSubmitting(false);
      }
    } else {
      const { error: signUpError } = await signUp(email, password);
      if (signUpError) {
        setError(signUpError);
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-base-950 flex items-center justify-center relative overflow-hidden">
      {/* Radar grid background */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(34, 211, 238, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 211, 238, 0.15) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-accent-cyan/10 animate-[spin_30s_linear_infinite]"
        style={{ borderTopColor: 'rgba(34, 211, 238, 0.2)' }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-accent-cyan/5" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] rounded-full border border-accent-cyan/5" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 mb-4 relative">
            <div className="absolute inset-0 rounded-full border-2 border-accent-cyan/30 animate-pulse" />
            <div className="absolute inset-2 rounded-full border border-accent-cyan/20" />
            <div className="w-2 h-2 rounded-full bg-accent-cyan" />
          </div>
          <h1 className="text-2xl font-bold tracking-widest text-white mb-1">JOB RADAR</h1>
          <p className="text-xs text-slate-500 mono tracking-wider uppercase">Operations Console</p>
        </div>

        <form onSubmit={handleSubmit} className="panel p-6 space-y-4">
          <div>
            <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1.5 block">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="operator@jobradar.io"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1.5 block">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label className="text-2xs text-slate-400 uppercase tracking-wider mb-1.5 block">
                Confirm Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={cn(
              'btn-primary w-full justify-center py-2.5',
              submitting && 'opacity-50 cursor-not-allowed'
            )}
          >
            {submitting
              ? mode === 'signin'
                ? 'Authenticating...'
                : 'Creating account...'
              : mode === 'signin'
                ? 'Access Console'
                : 'Create Account'}
          </button>
        </form>

        <div className="text-center mt-4">
          {mode === 'signin' ? (
            <button
              onClick={() => switchMode('signup')}
              className="text-2xs text-slate-500 hover:text-accent-cyan transition-colors mono"
            >
              Need an account? CREATE ONE
            </button>
          ) : (
            <button
              onClick={() => switchMode('signin')}
              className="text-2xs text-slate-500 hover:text-accent-cyan transition-colors mono"
            >
              Already have an account? SIGN IN
            </button>
          )}
        </div>

        <p className="text-center text-2xs text-slate-600 mt-4 mono">
          PRIVATE SYSTEM · AUTHORIZED OPERATOR ONLY
        </p>
      </div>
    </div>
  );
}
