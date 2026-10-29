'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { LogOut } from 'lucide-react'

/**
 * Logout button with custom confirmation dialog.
 * Dialog is portaled to document.body so it covers the full screen
 * (sidebar CSS transforms would otherwise clip fixed positioning).
 */
export default function LogoutButton({
  onLogout,
  className = '',
  iconOnly = false,
  label = 'Logout',
  variant = 'default',
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const confirm = async () => {
    setBusy(true)
    try {
      await onLogout?.()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const btnBase =
    variant === 'sidebar'
      ? `w-full flex items-center ${iconOnly ? 'justify-center px-2' : 'space-x-3 px-4'} py-3 rounded-lg hover:bg-red-50 text-red-600 ${className}`
      : iconOnly
        ? `h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 active:bg-slate-200 ${className}`
        : `inline-flex items-center justify-center gap-2 px-3 py-2 sm:px-4 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all text-xs sm:text-base font-medium ${className}`

  const dialog =
    open && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
              aria-label="Dismiss"
              disabled={busy}
              onClick={() => setOpen(false)}
            />
            <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-3">
                  <LogOut className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Sign out?</h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  You will be logged out of this device. You can sign back in anytime with your PIN.
                </p>
              </div>
              <div className="p-4 flex flex-col-reverse sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="flex-1 h-11 rounded-xl bg-slate-100 text-slate-800 font-semibold disabled:opacity-50"
                >
                  Stay signed in
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={confirm}
                  className="flex-1 h-11 rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50"
                >
                  {busy ? 'Signing out…' : 'Yes, sign out'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnBase}
        aria-label="Logout"
      >
        <LogOut className={variant === 'sidebar' ? (iconOnly ? 'w-6 h-6' : 'w-5 h-5') : iconOnly ? 'w-4 h-4 sm:w-5 sm:h-5' : 'w-4 h-4'} />
        {!iconOnly && <span className={variant === 'sidebar' ? 'font-medium' : 'sm:inline'}>{label}</span>}
        {!iconOnly && variant !== 'sidebar' && (
          <span className="sm:hidden sr-only">{label}</span>
        )}
      </button>
      {dialog}
    </>
  )
}
