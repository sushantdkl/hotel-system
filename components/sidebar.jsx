'use client'

import { BarChart3, ChefHat, Package, UtensilsCrossed, FileText, Users, Settings, Home, Store } from 'lucide-react'

export default function Sidebar({ currentPage, onNavigate, shopInfo, onLogout }) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'orders', label: 'Orders', icon: UtensilsCrossed },
    { id: 'menu', label: 'Menu Items', icon: ChefHat },
    { id: 'ingredients', label: 'Ingredients', icon: Package },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  // Debug: Log shopInfo to console
  console.log('Sidebar shopInfo:', shopInfo)

  return (
    <div className="pos-sidebar w-64 flex flex-col py-6 px-4 gap-2 bg-background">
      <div className="px-2 py-4 mb-4">
        <div className="flex items-center gap-2 text-primary font-bold text-lg">
          <Store size={28} />
          <span className="hidden sm:inline">{shopInfo?.name || 'RestaurantPOS'}</span>
        </div>
        {/* {shopInfo && ( */}
          {/* // <div className="mt-3 p-2 bg-primary/10 rounded-lg text-xs">
          //   <div className="flex items-center gap-1 text-muted-foreground">
          //     {shopInfo.status === 'trial' ? '🔵 Trial' : '✅ Active'} • {shopInfo.subscription_plan}
          //   </div>
          // </div> */}
        {/* )} */}
      </div>

      <nav className="flex-1 space-y-1">
        {menuItems.map(item => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left font-medium text-sm sm:text-base ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="pt-4 border-t border-border">
        <button 
          onClick={onLogout}
          className="w-full px-4 py-3 text-destructive hover:bg-destructive/10 rounded-lg transition-colors font-medium text-left text-sm sm:text-base"
        >
          Logout
        </button>
      </div>
    </div>
  )
}
