import * as React from "react"

export function Card({ className = "", children, ...props }) {
  return (
    <div
      className={`rounded-xl border-2 border-gray-200 bg-white shadow-lg hover:shadow-xl transition-shadow ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className = "", children, ...props }) {
  return (
    <div className={`flex flex-col space-y-1.5 p-6 border-b-2 border-gray-100 bg-gray-50 ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className = "", children, ...props }) {
  return (
    <h3
      className={`text-xl font-bold text-gray-900 leading-none tracking-tight ${className}`}
      {...props}
    >
      {children}
    </h3>
  )
}

export function CardDescription({ className = "", children, ...props }) {
  return (
    <p className={`text-sm font-medium text-gray-600 ${className}`} {...props}>
      {children}
    </p>
  )
}

export function CardContent({ className = "", children, ...props }) {
  return (
    <div className={`p-6 pt-4 text-gray-700 ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className = "", children, ...props }) {
  return (
    <div className={`flex items-center p-6 pt-0 ${className}`} {...props}>
      {children}
    </div>
  )
}
