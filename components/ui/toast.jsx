'use client'

import * as React from "react"
import { X } from "lucide-react"

const ToastContext = React.createContext({})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([])

  const addToast = React.useCallback(({ title, description, variant = 'default', duration = 3000 }) => {
    const id = Math.random().toString(36).substr(2, 9)
    const toast = { id, title, description, variant }
    
    setToasts((prev) => [...prev, toast])
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
      }, duration)
    }
    
    return id
  }, [])

  const removeToast = React.useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:top-auto sm:right-0 sm:bottom-0 sm:flex-col md:max-w-[420px]">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

const toastVariants = {
  default: "bg-white border-gray-300 shadow-xl",
  success: "bg-green-500 border-green-600 text-white shadow-xl",
  error: "bg-red-500 border-red-600 text-white shadow-xl",
  warning: "bg-yellow-500 border-yellow-600 text-white shadow-xl",
}

function Toast({ title, description, variant = 'default', onClose }) {
  const variantStyles = toastVariants[variant] || toastVariants.default
  
  return (
    <div
      className={`pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all mb-2 ${variantStyles}`}
    >
      <div className="grid gap-1">
        {title && <div className="text-sm font-bold">{title}</div>}
        {description && <div className="text-sm font-medium">{description}</div>}
      </div>
      <button
        onClick={onClose}
        className="absolute right-2 top-2 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
