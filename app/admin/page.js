'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PRIMARY_ROUTE } from '@/lib/deployment'

export default function AdminPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace(PRIMARY_ROUTE)
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-gray-900 mx-auto mb-4"></div>
        <p className="text-gray-800">Redirecting...</p>
      </div>
    </div>
  )
}
