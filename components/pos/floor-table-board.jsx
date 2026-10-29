'use client';

/**
 * Shared floor table board (admin + cashier dashboards).
 * Available = green, running = blue, reserved = red.
 */

import { formatCurrency } from '@/lib/currency';
import { useOpenDuration } from '@/components/tables/table-open-duration';

export function tableBoardState(table) {
  const running = (table.parties || []).length > 0 || table.current_order_id;
  if (running) return 'running';
  if (['reserved', 'reserved_arrived'].includes(table.status)) return 'reserved';
  return 'available';
}

export function isRunningTable(table) {
  return tableBoardState(table) === 'running';
}

export function isReservedTable(table) {
  return tableBoardState(table) === 'reserved';
}

export function groupTablesByRoom(tables = []) {
  const map = new Map();
  for (const table of tables) {
    const floor = String(table.floor || 'Main').trim() || 'Main';
    const section = String(table.section || '').trim();
    const room = section ? `${floor} · ${section}` : floor;
    if (!map.has(room)) map.set(room, { room, floorLabel: floor, tables: [] });
    map.get(room).tables.push(table);
  }
  return [...map.values()].sort((a, b) => a.room.localeCompare(b.room));
}

export function tableStatusCounts(tables = []) {
  const counts = { available: 0, running: 0, reserved: 0 };
  for (const table of tables) counts[tableBoardState(table)] += 1;
  return counts;
}

export function FloorTableBoard({
  tables = [],
  roomFilter = 'all',
  statusFilter = 'all',
  onRoomFilter,
  onStatusFilter,
  onTableClick,
}) {
  const rooms = groupTablesByRoom(tables);
  const statusCounts = tableStatusCounts(tables);
  const visibleRooms = rooms
    .map((group) => ({
      ...group,
      tables: group.tables.filter(
        (table) =>
          (roomFilter === 'all' || group.room === roomFilter) &&
          (statusFilter === 'all' || tableBoardState(table) === statusFilter)
      ),
    }))
    .filter((group) => (roomFilter === 'all' || group.room === roomFilter) && group.tables.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <RoomFilterButton
          active={roomFilter === 'all'}
          onClick={() => onRoomFilter?.('all')}
          label="All Rooms"
          count={tables.length}
        />
        {rooms.map((group) => (
          <RoomFilterButton
            key={group.room}
            active={roomFilter === group.room}
            onClick={() => onRoomFilter?.(group.room)}
            label={group.room}
            sub={`Floor: ${group.floorLabel}`}
            count={group.tables.length}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-y border-gray-100 py-3">
        {[
          ['all', 'All', tables.length],
          ['available', 'Available', statusCounts.available],
          ['running', 'Running', statusCounts.running],
          ['reserved', 'Reserved', statusCounts.reserved],
        ].map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => onStatusFilter?.(value)}
            className={`rounded-full px-4 py-2 text-xs font-bold text-white shadow-sm transition-[transform,filter,box-shadow] duration-150 hover:brightness-95 active:scale-[0.97] ${
              value === 'available'
                ? 'bg-emerald-600'
                : value === 'running'
                  ? 'bg-blue-600'
                  : value === 'reserved'
                    ? 'bg-red-600'
                    : 'bg-slate-700'
            } ${statusFilter === value ? 'ring-2 ring-gray-900 ring-offset-2' : ''}`}
            aria-pressed={statusFilter === value}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {visibleRooms.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No tables match this filter.</p>
      ) : (
        visibleRooms.map((group) => (
          <div key={group.room}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-gray-900">{group.room}</h3>
                <p className="text-xs text-gray-500">Floor: {group.floorLabel}</p>
              </div>
              <span className="text-xs font-medium text-gray-400">
                {group.tables.length} Table{group.tables.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {group.tables.map((table) => (
                <DashboardTableCard
                  key={table.id}
                  table={table}
                  onClick={() => onTableClick?.(table)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function RoomFilterButton({ active, onClick, label, sub, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-max rounded-lg border px-3 py-2 text-left transition-transform duration-150 active:scale-[0.97] ${
        active ? 'border-gray-950 bg-gray-950 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
      }`}
    >
      <span className="block text-xs font-semibold">
        {label} <span className={active ? 'text-gray-300' : 'text-gray-400'}>({count})</span>
      </span>
      {sub && (
        <span className={`mt-0.5 block text-[10px] ${active ? 'text-gray-300' : 'text-gray-400'}`}>• {sub}</span>
      )}
    </button>
  );
}

function DashboardTableCard({ table, onClick }) {
  const state = tableBoardState(table);
  const running = state === 'running';
  const reserved = state === 'reserved';
  const openFor = useOpenDuration(table.opened_at, running);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[116px] rounded-lg border-2 p-3 text-left transition-[border-color,box-shadow,transform] duration-150 hover:shadow-md active:scale-[0.98] ${
        running
          ? 'border-blue-600 bg-blue-600 text-white hover:brightness-95'
          : reserved
            ? 'border-red-600 bg-red-600 text-white hover:brightness-95'
            : 'border-emerald-600 bg-emerald-600 text-white hover:brightness-95'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-xl font-bold">{table.table_number}</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
          {state === 'running' ? 'Running' : state === 'reserved' ? 'Reserved' : 'Available'}
        </span>
      </div>
      <p className={`mt-1 text-xs ${running || reserved ? 'text-white/80' : 'text-white/80'}`}>
        {Number(table.capacity || 0)} Seat{Number(table.capacity || 0) === 1 ? '' : 's'}
      </p>
      {running ? (
        <div className="mt-2 space-y-0.5">
          <p className="text-xs font-semibold">
            {table.party_count || 1} part{(table.party_count || 1) === 1 ? 'y' : 'ies'} ·{' '}
            {formatCurrency(table.current_amount || 0)}
          </p>
          {openFor ? (
            <p className="text-[11px] font-semibold text-white/95" title="Time since this table opened">
              Open {openFor}
            </p>
          ) : null}
          {table.unsent_count > 0 && (
            <p className="text-[11px] font-medium text-amber-200">{table.unsent_count} unsent</p>
          )}
        </div>
      ) : reserved ? (
        <p className="mt-2 text-xs font-medium text-white/90">View reservation</p>
      ) : (
        <p className="mt-2 text-xs font-medium text-white/90">Open in POS</p>
      )}
    </button>
  );
}
