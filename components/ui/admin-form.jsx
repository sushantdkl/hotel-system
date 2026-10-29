'use client';

/** Roomy admin form controls — shared across modals and inline forms. */

export const adminInputClass =
  'h-11 sm:h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10';

export const adminSelectClass = adminInputClass;

export const adminTextareaClass =
  'min-h-[6rem] w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10';

export const adminLabelClass = 'mb-2 block text-sm font-medium text-gray-700';

export const adminFieldStackClass = 'space-y-6';

export const adminDialogMd = 'w-full sm:max-w-2xl';

export const adminDialogLg = 'w-full sm:max-w-4xl';

export const adminDialogXl = 'w-full sm:max-w-5xl';

export const adminBtnPrimary =
  'inline-flex h-11 sm:h-12 min-w-[7rem] items-center justify-center rounded-xl bg-gray-900 px-6 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50';

export const adminBtnSecondary =
  'inline-flex h-11 sm:h-12 min-w-[7rem] items-center justify-center rounded-xl border border-gray-300 bg-white px-6 text-sm font-semibold text-gray-700 hover:bg-gray-50';

export function AdminField({ label, required, hint, children }) {
  return (
    <label className="block">
      <span className={adminLabelClass}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-2 block text-xs leading-relaxed text-gray-500">{hint}</span>}
    </label>
  );
}
