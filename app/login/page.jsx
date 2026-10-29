'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BedDouble, Delete, LogIn, RefreshCw, ShieldCheck, UserRound, UtensilsCrossed } from 'lucide-react'
import { RESTAURANT } from '@/lib/restaurant-info.js'
import { ROLE_LABELS, canSignInTo } from '@/lib/roles'

const SIDES = [
  { id: 'restaurant', label: 'Restaurant', icon: UtensilsCrossed },
  { id: 'hotel', label: 'Hotel', icon: BedDouble },
]

const BRAND_NAME = RESTAURANT.name

export default function LoginPage() {
  const [side, setSide] = useState('restaurant')
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState(null)
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const sideUsers = users.filter((user) => canSignInTo(side, user.role))

  useEffect(() => {
    try {
      const saved = localStorage.getItem('login_side')
      if (saved === 'hotel') setSide('hotel')
    } catch { /* ignore */ }
  }, [])

  const chooseSide = (next) => {
    setSide(next)
    try { localStorage.setItem('login_side', next) } catch { /* ignore */ }
    const first = users.find((user) => canSignInTo(next, user.role)) || null
    setSelectedUser(first)
    setUsername(first?.username || '')
    setPin('')
    setError('')
  }

  useEffect(() => {
    let cancelled = false

    async function loadUsers() {
      setUsersLoading(true)

      try {
        const response = await fetch('/api/users/active', { cache: 'no-store' })
        const data = await response.json()
        const activeUsers = Array.isArray(data.users) ? data.users : []

        if (!cancelled) {
          setUsers(activeUsers)
          const savedSide = localStorage.getItem('login_side') === 'hotel' ? 'hotel' : 'restaurant'
          const firstUser = activeUsers.find((user) => canSignInTo(savedSide, user.role)) || null
          setSelectedUser(firstUser)
          setUsername(firstUser?.username || '')
        }
      } catch {
        if (!cancelled) {
          const fallbackUser = { username: 'admin', full_name: 'Administrator', role: 'admin' }
          setUsers([fallbackUser])
          setSelectedUser(fallbackUser)
          setUsername(fallbackUser.username)
        }
      } finally {
        if (!cancelled) setUsersLoading(false)
      }
    }

    loadUsers()
    return () => {
      cancelled = true
    }
  }, [])

  const handleUserSelect = (user) => {
    setSelectedUser(user)
    setUsername(user.username)
    setPin('')
    setError('')
  }

  const handlePinClick = (num) => {
    if (pin.length < 32) {
      setPin(pin + num)
      setError('')
    }
  }

  const handleClear = () => {
    setPin('')
    setError('')
  }

  const handleBackspace = () => {
    setPin(pin.slice(0, -1))
    setError('')
  }

  const handleLogin = async () => {
    if (!username.trim()) {
      setError('Select a user first')
      return
    }
    if (pin.length < 4) {
      setError('Enter your PIN or password (at least 4 characters)')
      return
    }

    setLoading(true)
    setError('')

    const result = await login(username.trim(), pin, side)

    if (!result.success) {
      setError(result.error || 'Invalid credentials')
      setPin('')
    }
    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #F7F3EC 0%, #efe6d8 100%)' }}
      onKeyDown={handleKeyDown}
    >
      <Card className="w-full max-w-5xl shadow-2xl border" style={{ borderColor: '#E6DED5' }}>
        <CardHeader className="text-center space-y-2">
          <div
            className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-md"
            style={{ background: '#8F3F2D' }}
          >
            <ShieldCheck className="w-7 h-7" />
          </div>
          <CardTitle className="text-xl" style={{ color: '#211A17' }}>{BRAND_NAME}</CardTitle>
          <CardDescription>Choose restaurant or hotel, select your user and enter your PIN</CardDescription>
          <div role="tablist" aria-label="Sign in to" className="mx-auto mt-2 grid w-full max-w-sm grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
            {SIDES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={side === id}
                onClick={() => chooseSide(id)}
                disabled={loading}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${side === id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase text-stone-500">Users</h2>
                  <p className="text-sm text-stone-600">Choose your username from the list.</p>
                </div>
                {usersLoading && (
                  <RefreshCw className="h-4 w-4 animate-spin text-stone-400" aria-label="Loading users" />
                )}
              </div>

              <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                {sideUsers.map((user) => {
                  const isSelected = selectedUser?.username === user.username
                  return (
                    <button
                      key={user.username}
                      type="button"
                      onClick={() => handleUserSelect(user)}
                      disabled={loading}
                      className={`flex w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition ${
                        isSelected
                          ? 'bg-stone-900 text-white shadow-sm'
                          : 'bg-white text-stone-900 hover:bg-stone-50'
                      } disabled:opacity-60`}
                      style={{ borderColor: isSelected ? '#211A17' : '#E6DED5' }}
                      aria-pressed={isSelected}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                          isSelected ? 'bg-white/15' : 'bg-stone-100'
                        }`}
                      >
                        <UserRound className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold">{user.username}</span>
                        <span className={`block truncate text-xs capitalize ${isSelected ? 'text-stone-200' : 'text-stone-500'}`}>
                          {user.full_name || 'Staff'} · {user.role_label || ROLE_LABELS[user.role] || user.role}
                        </span>
                      </span>
                    </button>
                  )
                })}

                {!usersLoading && sideUsers.length === 0 && (
                  <div className="rounded-lg border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-600">
                    No active users found.
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <label htmlFor="admin-pin" className="block text-sm font-medium mb-1 text-stone-700">
                  PIN or password
                </label>
                <input
                  id="admin-pin"
                  type="password"
                  autoComplete="current-password"
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setError('') }}
                  className="w-full px-3 py-3 border-2 rounded-xl text-stone-900 text-center text-xl font-mono focus:outline-none focus:ring-2"
                  style={{ borderColor: '#E6DED5' }}
                  placeholder="PIN"
                />
                <p className="mt-2 text-sm text-stone-600">
                  Signing in as <span className="font-semibold text-stone-900">{username || 'no user selected'}</span>
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handlePinClick(num.toString())}
                    disabled={loading || !username}
                    className="h-14 text-xl font-semibold bg-white border-2 rounded-xl hover:bg-stone-50 active:scale-95 disabled:opacity-50 transition-transform"
                    style={{ borderColor: '#E6DED5' }}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={loading || !username}
                  className="h-14 bg-stone-200 border-2 border-stone-300 rounded-xl hover:bg-stone-300 active:scale-95 disabled:opacity-50 text-sm font-medium transition-transform"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handlePinClick('0')}
                  disabled={loading || !username}
                  className="h-14 text-xl font-semibold bg-white border-2 rounded-xl hover:bg-stone-50 active:scale-95 disabled:opacity-50 transition-transform"
                  style={{ borderColor: '#E6DED5' }}
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleBackspace}
                  disabled={loading || !username}
                  className="h-14 bg-stone-200 border-2 border-stone-300 rounded-xl hover:bg-stone-300 active:scale-95 disabled:opacity-50 flex items-center justify-center transition-transform"
                  aria-label="Delete last digit"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>

              <Button
                onClick={handleLogin}
                disabled={!username.trim() || pin.length < 4 || loading}
                className="w-full h-12 text-lg"
                size="lg"
                style={{ background: '#8F3F2D' }}
              >
                {loading ? <span>Signing in...</span> : (<><LogIn className="w-5 h-5 mr-2" /> Sign in</>)}
              </Button>
            </section>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
