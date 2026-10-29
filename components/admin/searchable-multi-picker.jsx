'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'

/**
 * Click-to-toggle multi-select with search. Replaces native <select multiple>
 * (no Ctrl/Cmd required).
 */
export default function SearchableMultiPicker({
  options = [],
  value = [],
  onChange,
  placeholder = 'Search…',
  emptyLabel = 'Nothing matches.',
  getLabel = (option) => option.name,
  getId = (option) => Number(option.id),
}) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set((value || []).map(Number)), [value])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => getLabel(option).toLowerCase().includes(needle))
  }, [options, query, getLabel])

  const selectedOptions = useMemo(
    () => options.filter((option) => selected.has(getId(option))),
    [options, selected, getId]
  )

  const toggle = (id) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  const clear = () => onChange([])

  return (
    <div className="overflow-hidden rounded-xl border border-gray-300 bg-white">
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-2">
          {selectedOptions.map((option) => {
            const id = getId(option)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white"
              >
                {getLabel(option)}
                <X className="h-3 w-3 opacity-80" />
              </button>
            )
          })}
          <button type="button" onClick={clear} className="ml-auto text-[11px] font-semibold text-gray-500 hover:text-gray-800">
            Clear all
          </button>
        </div>
      )}
      <div className="relative border-b border-gray-100">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="h-11 w-full bg-transparent pl-9 pr-3 text-sm text-gray-950 outline-none placeholder:text-gray-400"
        />
      </div>
      <ul className="max-h-48 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-gray-400">{emptyLabel}</li>
        ) : (
          filtered.map((option) => {
            const id = getId(option)
            const checked = selected.has(id)
            return (
              <li key={id}>
                <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 ${checked ? 'bg-rose-50/60' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(id)}
                    className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span className={`flex-1 ${checked ? 'font-semibold text-gray-950' : 'text-gray-700'}`}>{getLabel(option)}</span>
                </label>
              </li>
            )
          })
        )}
      </ul>
      <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400">
        {selected.size} selected · click to add or remove
      </p>
    </div>
  )
}
