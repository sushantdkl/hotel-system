'use client'

import { useState } from 'react'
import { Plus, Edit2, Trash2, Lock } from 'lucide-react'

export default function UserManagement() {
  const [users, setUsers] = useState([
    { id: 1, name: 'John Admin', email: 'john@pos.com', role: 'Admin', status: 'active', lastLogin: '2025-01-15' },
    { id: 2, name: 'Mike Cashier', email: 'mike@pos.com', role: 'Cashier', status: 'active', lastLogin: '2025-01-15' },
    { id: 3, name: 'Sarah Manager', email: 'sarah@pos.com', role: 'Manager', status: 'active', lastLogin: '2025-01-14' },
  ])

  const [showForm, setShowForm] = useState(false)

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">User Management</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="pos-button-primary px-6 py-3 rounded-lg font-semibold flex items-center gap-2"
        >
          <Plus size={20} />
          Add User
        </button>
      </div>

      <div className="pos-stat-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr className="text-muted-foreground font-semibold">
                <th className="text-left py-3 px-4">Name</th>
                <th className="text-left py-3 px-4">Email</th>
                <th className="text-left py-3 px-4">Role</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Last Login</th>
                <th className="text-left py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="py-3 px-4 font-semibold">{user.name}</td>
                  <td className="py-3 px-4 text-muted-foreground">{user.email}</td>
                  <td className="py-3 px-4">
                    <span className="px-3 py-1 bg-primary/20 text-primary rounded-full text-xs font-semibold">
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-xs font-semibold">
                      {user.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{user.lastLogin}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      <button className="text-primary hover:bg-primary/10 p-2 rounded transition-colors">
                        <Edit2 size={16} />
                      </button>
                      <button className="text-secondary hover:bg-secondary/10 p-2 rounded transition-colors">
                        <Lock size={16} />
                      </button>
                      <button className="text-destructive hover:bg-destructive/10 p-2 rounded transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
