import * as React from "react"

const badgeVariants = {
  default: "bg-blue-100 text-blue-900 border-blue-300",
  success: "bg-green-100 text-green-900 border-green-300",
  warning: "bg-yellow-100 text-yellow-900 border-yellow-300",
  danger: "bg-red-100 text-red-900 border-red-300",
  secondary: "bg-gray-100 text-gray-900 border-gray-400",
  outline: "bg-white text-gray-800 border-gray-400",
}

export function Badge({ 
  className = "", 
  variant = "default",
  children,
  ...props 
}) {
  const baseStyles = "inline-flex items-center rounded-full border-2 px-3 py-1 text-xs font-bold uppercase tracking-wide transition-all shadow-sm"
  const variantStyles = badgeVariants[variant] || badgeVariants.default
  
  return (
    <span className={`${baseStyles} ${variantStyles} ${className}`} {...props}>
      {children}
    </span>
  )
}
