import React, { useState } from 'react';
import { Lock, ArrowRight, ShieldCheck } from 'lucide-react';
import { Logo } from './Logo';

interface LoginScreenProps {
  onLoginSuccess: () => void;
  onOpenBroadcastOnly: () => void;
}

export const DEMO_ADMIN_PASSCODE = 'nuridua-demo';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onOpenBroadcastOnly,
}) => {
  const [operatorName, setOperatorName] = useState('Studio Admin');
  const [passcode, setPasscode] = useState(DEMO_ADMIN_PASSCODE);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorName.trim()) {
      setError('Please enter an operator display name.');
      return;
    }
    if (passcode.trim() !== DEMO_ADMIN_PASSCODE) {
      setError(`Invalid demo passcode. Use "${DEMO_ADMIN_PASSCODE}" for this local prototype.`);
      return;
    }
    setError(null);
    sessionStorage.setItem('nur_i_dua_admin_auth', 'demo-authenticated');
    sessionStorage.setItem('nur_i_dua_operator', operatorName.trim().slice(0, 32));
    onLoginSuccess();
  };

  return (
    <div className="min-h-screen bg-[#060B17] islamic-lattice-bg flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-[#0B1328] border border-[#1E3361] p-7 sm:p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <Logo />
          <div className="mt-4 h-px w-28 bg-[#C9A45C]/40" />
          <h1 className="mt-5 font-display text-2xl font-semibold text-white">
            Admin Control Center
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Interactive Islamic Prayer Broadcast Studio
          </p>
        </div>

        {/* Honest Local Prototype Notice */}
        <div className="mt-6 bg-[#101C3B] border border-[#C9A45C]/30 p-3.5 text-xs text-slate-300 leading-relaxed">
          <div className="flex items-center gap-2 font-semibold text-[#E5C88B]">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Local Prototype Demo Authentication</span>
          </div>
          <p className="mt-1 text-slate-300">
            No production credentials are stored or transmitted. Use the pre-filled demo passcode{' '}
            <code className="font-mono text-[#E5C88B]">{DEMO_ADMIN_PASSCODE}</code> to enter the control center.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="operator-name" className="block text-xs font-medium text-slate-300 mb-1.5">
              Operator Name
            </label>
            <input
              id="operator-name"
              type="text"
              value={operatorName}
              onChange={(e) => setOperatorName(e.target.value)}
              maxLength={32}
              className="w-full bg-[#070E1F] border border-[#233969] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#C9A45C]"
              placeholder="Studio Admin"
            />
          </div>

          <div>
            <label htmlFor="demo-passcode" className="block text-xs font-medium text-slate-300 mb-1.5">
              Demo Passcode
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="demo-passcode"
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full bg-[#070E1F] border border-[#233969] pl-10 pr-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-[#C9A45C]"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-500/30 px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-[#C9A45C] hover:bg-[#D7B46E] text-[#070D1B] font-semibold text-sm py-2.5 px-4 transition-colors cursor-pointer"
          >
            <span>Enter Control Center</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#1C2F5A] flex items-center justify-between text-xs text-slate-400">
          <span>OBS Browser Source</span>
          <button
            type="button"
            onClick={onOpenBroadcastOnly}
            className="text-[#E5C88B] hover:underline cursor-pointer"
          >
            Open 1080×1920 Broadcast View
          </button>
        </div>
      </div>
    </div>
  );
};
