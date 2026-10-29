'use client'

import { formatCalendarDate } from '@/lib/calendar-system.js'

export default function StockHistory() {
  const history = [
    { id: 1, product: 'Laptop', type: 'in', quantity: 5, date: '2025-01-10', user: 'Admin' },
    { id: 2, product: 'Shampoo', type: 'out', quantity: 2, date: '2025-01-09', user: 'Cashier 1' },
    { id: 3, product: 'Aspirin', type: 'in', quantity: 10, date: '2025-01-08', user: 'Admin' },
  ]

  return (
    <div className="pos-stat-card">
      <h3 className="text-xl font-bold mb-6 text-foreground">Stock History</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr className="text-muted-foreground font-semibold">
              <th className="text-left py-3 px-4">Product</th>
              <th className="text-left py-3 px-4">Type</th>
              <th className="text-right py-3 px-4">Quantity</th>
              <th className="text-left py-3 px-4">Date</th>
              <th className="text-left py-3 px-4">User</th>
            </tr>
          </thead>
          <tbody>
            {history.map(item => (
              <tr key={item.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                <td className="py-3 px-4 font-semibold">{item.product}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    item.type === 'in'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  }`}>
                    {item.type.toUpperCase()}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-bold">{item.quantity}</td>
                <td className="py-3 px-4 text-muted-foreground">{formatCalendarDate(item.date)}</td>
                <td className="py-3 px-4">{item.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
