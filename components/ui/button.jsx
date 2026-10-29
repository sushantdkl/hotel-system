import * as React from "react"

const buttonVariants = {
  default: "bg-blue-600 text-white hover:bg-blue-700 border-2 border-blue-700 shadow-md hover:shadow-lg",
  destructive: "bg-red-600 text-white hover:bg-red-700 border-2 border-red-700 shadow-md hover:shadow-lg",
  outline: "border-2 border-gray-400 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-500 shadow-sm",
  secondary: "bg-gray-600 text-white hover:bg-gray-700 border-2 border-gray-700 shadow-md",
  ghost: "hover:bg-gray-100 text-gray-700 hover:text-gray-900",
  link: "text-blue-600 underline-offset-4 hover:underline font-semibold",
  success: "bg-green-600 text-white hover:bg-green-700 border-2 border-green-700 shadow-md hover:shadow-lg",
  warning: "bg-yellow-600 text-white hover:bg-yellow-700 border-2 border-yellow-700 shadow-md hover:shadow-lg",
}

const buttonSizes = {
  default: "h-10 px-4 py-2",
  sm: "h-9 px-3 text-sm",
  lg: "h-11 px-8 text-lg",
  icon: "h-10 w-10",
}

export function Button({
  className = "",
  variant = "default",
  size = "default",
  disabled = false,
  children,
  onClick,
  type = "button",
  ...props
}) {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed"
  
  const variantStyles = buttonVariants[variant] || buttonVariants.default
  const sizeStyles = buttonSizes[size] || buttonSizes.default
  
  return (
    <button
      type={type}
      className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  )
}
