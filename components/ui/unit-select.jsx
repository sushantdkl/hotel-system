'use client';

/**
 * Unit picker: a themed combobox that is also a text box.
 *
 * The owner wants both — a grouped list for the units everyone shares, and free
 * typing for the ones only this kitchen uses (`box_24`). On blur a recognised
 * spelling snaps to its canonical key ("Kilos" -> "kg"); anything unrecognised
 * is left exactly as typed.
 */

import Combobox from '@/components/ui/combobox';
import { unitsByFamily, normalizeUnit, findUnit } from '@/lib/units';

export default function UnitSelect({
  value,
  onChange,
  placeholder = 'kg',
  className = '',
  disabled = false,
  autoFocus = false,
}) {
  const groups = unitsByFamily().map((g) => ({
    label: g.label,
    options: g.units.map((u) => ({ value: u.key, label: u.label, hint: u.abbr })),
  }));
  const known = findUnit(value);

  return (
    <div>
      <Combobox
        value={value}
        onChange={onChange}
        onBlur={(e) => {
          // Snap only what we recognise. A custom unit survives untouched.
          const canonical = normalizeUnit(e.target.value);
          if (canonical && canonical !== e.target.value) onChange(canonical);
        }}
        groups={groups}
        placeholder={placeholder}
        className={className || undefined}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {value && !known && <span className="mt-1 block text-xs text-gray-400">Custom unit — kept as typed.</span>}
    </div>
  );
}
