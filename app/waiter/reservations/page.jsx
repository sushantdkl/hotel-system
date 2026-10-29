'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy Bookings route → integrated Reservations tab */
export default function WaiterReservationsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/waiter?tab=reservations')
  }, [router])
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 text-sm">
      Opening reservations…
    </div>
  )
}
