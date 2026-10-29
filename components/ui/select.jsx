import * as React from "react"

export const Select = React.forwardRef(({ 
  className = "", 
  children,
  error = false,
  ...props 
}, ref) => {
  const baseStyles = "flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
  
  const errorStyles = error 
    ? "border-red-500 focus:ring-red-500" 
    : "border-gray-300 focus:ring-blue-500"
  
  return (
    <select
      className={`${baseStyles} ${errorStyles} ${className}`}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  )
})

Select.displayName = "Select"
