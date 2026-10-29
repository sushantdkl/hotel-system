'use client'

import * as React from "react"
import { X } from "lucide-react"

export function Dialog({ open, onOpenChange, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 sm:px-6">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-[80] w-full sm:w-auto max-h-[94dvh] sm:max-h-[92dvh] overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  )
}

export function DialogContent({ 
  className = "", 
  children,
  onClose,
  ...props 
}) {
  return (
    <div
      className={`relative mx-auto w-full max-w-[100vw] rounded-t-2xl sm:rounded-2xl border border-gray-200 bg-white p-6 sm:p-10 shadow-lg max-h-[94dvh] sm:max-h-[92dvh] overflow-y-auto sm:max-w-2xl ${className}`}
      {...props}
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-900/20 min-h-11 min-w-11 flex items-center justify-center bg-gray-50 sm:bg-transparent"
        >
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </button>
      )}
      {children}
    </div>
  )
}

export function DialogHeader({ className = "", children, ...props }) {
  return (
    <div className={`flex flex-col space-y-2 pr-10 text-left ${className}`} {...props}>
      {children}
    </div>
  )
}

export function DialogTitle({ className = "", children, ...props }) {
  return (
    <h2 className={`text-xl sm:text-2xl font-bold leading-tight tracking-tight text-gray-900 ${className}`} {...props}>
      {children}
    </h2>
  )
}

export function DialogDescription({ className = "", children, ...props }) {
  return (
    <p className={`text-sm sm:text-base text-gray-500 leading-relaxed ${className}`} {...props}>
      {children}
    </p>
  )
}

export function DialogFooter({ className = "", children, ...props }) {
  return (
    <div className={`mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-4 ${className}`} {...props}>
      {children}
    </div>
  )
}
