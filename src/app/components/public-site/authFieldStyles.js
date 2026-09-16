// Shared presentational constants for the auth pages (login/signup/join).
// Purely visual — no logic lives here. Matches the restrained, rounded-xl,
// solid-orange language used across the rest of the redesigned public site
// and the property page, replacing the old gradient/glow button + heavy
// shadow-2xl card treatment.

export const AUTH_LABEL_CLASS = 'block text-sm font-medium text-slate-700 mb-2';

export const AUTH_INPUT_CLASS =
  'w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-[15px]';

export const AUTH_SUBMIT_CLASS =
  'w-full py-3.5 rounded-xl bg-[#e48900] text-white font-semibold text-[15px] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';

export const AUTH_ERROR_CLASS =
  'p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm';

export const AUTH_LINK_CLASS = 'text-[#e48900] hover:underline font-medium';
