import * as React from "react"

export const Input = React.forwardRef(({ 
  className = "", 
  type = "text",
  error = false,
  ...props 
}, ref) => {
  const baseStyles = "flex h-11 w-full rounded-lg border-2 px-4 py-2.5 text-base text-gray-900 font-medium bg-white transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-100 shadow-sm"
  
  const errorStyles = error 
    ? "border-red-500 focus-visible:ring-red-500 focus-visible:border-red-500" 
    : "border-gray-300 focus-visible:ring-blue-500 focus-visible:border-blue-500"
  
  return (
    <input
      type={type}
      className={`${baseStyles} ${errorStyles} ${className}`}
      ref={ref}
      {...props}
    />
  )
})

Input.displayName = "Input"
