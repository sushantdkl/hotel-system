import * as React from "react"

export function Table({ className = "", children, ...props }) {
  return (
    <div className="relative w-full overflow-auto">
      <table className={`w-full caption-bottom text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  )
}

export function TableHeader({ className = "", children, ...props }) {
  return (
    <thead className={`border-b bg-gray-50 ${className}`} {...props}>
      {children}
    </thead>
  )
}

export function TableBody({ className = "", children, ...props }) {
  return (
    <tbody className={`[&_tr:last-child]:border-0 ${className}`} {...props}>
      {children}
    </tbody>
  )
}

export function TableFooter({ className = "", children, ...props }) {
  return (
    <tfoot className={`border-t bg-gray-50 font-medium ${className}`} {...props}>
      {children}
    </tfoot>
  )
}

export function TableRow({ className = "", children, ...props }) {
  return (
    <tr
      className={`border-b transition-colors hover:bg-gray-50 data-[state=selected]:bg-gray-50 ${className}`}
      {...props}
    >
      {children}
    </tr>
  )
}

export function TableHead({ className = "", children, ...props }) {
  return (
    <th
      className={`h-12 px-4 text-left align-middle font-medium text-gray-500 [&:has([role=checkbox])]:pr-0 ${className}`}
      {...props}
    >
      {children}
    </th>
  )
}

export function TableCell({ className = "", children, ...props }) {
  return (
    <td
      className={`p-4 align-middle [&:has([role=checkbox])]:pr-0 ${className}`}
      {...props}
    >
      {children}
    </td>
  )
}
