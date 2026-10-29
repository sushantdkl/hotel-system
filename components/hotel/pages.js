/**
 * Hotel pages: one list drives the sidebar (components/admin/admin-layout.jsx)
 * and each page's header (components/hotel/workspace.jsx). `permission` is one
 * key or a list where any one is enough; pages without one need hotel.view.
 */
import { BarChart3, BedDouble, CalendarDays, ClipboardCheck, ConciergeBell, LayoutGrid, Moon, ReceiptText, Share2, Shirt, Soup, Users, UtensilsCrossed, Wrench } from 'lucide-react';

export const HOTEL_PAGES = [
  { href: '/admin/hotel', label: 'Front desk', icon: ConciergeBell, permission: 'hotel.view', title: 'Front desk', description: 'Arrivals, departures, in-house guests, rooms and balances that need attention, with one-click actions.', booking: true },
  { href: '/admin/hotel/rooms', label: 'Room rack', icon: BedDouble, permission: 'hotel.view', title: 'Room rack', description: 'Every room by floor: occupancy, housekeeping, guest and balance. Click a room for everything about it.', booking: true },
  { href: '/admin/hotel/reservations', label: 'Reservations', icon: CalendarDays, permission: 'hotel.view', title: 'Reservations', description: 'Calendar and list of bookings; master reservations, deposits, date changes and online check-in.', booking: true },
  { href: '/admin/hotel/folios', label: 'Guest folios', icon: ReceiptText, permission: 'hotel.folios', title: 'Guest folios', description: 'Room nights, services, restaurant bills, deposits and payments per stay; windows, transfers and checkout.' },
  { href: '/admin/hotel/guests', label: 'Guests', icon: Users, permission: 'hotel.front_desk', title: 'Guests', description: 'Guest 360: profile, preferences, ID documents, stays, spend and balances.', booking: true },
  { href: '/admin/hotel/housekeeping', label: 'Housekeeping', icon: ClipboardCheck, permission: 'hotel.view', title: 'Housekeeping', description: 'Turnovers from checkout to inspection, stayovers, guest requests, DND, minibar and damage reports.' },
  { href: '/admin/hotel/maintenance', label: 'Maintenance', icon: Wrench, permission: ['hotel.maintenance', 'hotel.housekeeping', 'hotel.front_desk'], title: 'Maintenance', description: 'Repair tickets, out-of-order rooms and room maintenance history.' },
  { href: '/admin/hotel/laundry', label: 'Laundry', icon: Shirt, permission: ['hotel.laundry', 'hotel.folios'], title: 'Guest laundry', description: 'Guest laundry from collection to delivery; delivery posts the folio charge once.' },
  { href: '/admin/hotel/room-service', label: 'Room service', icon: Soup, permission: ['hotel.view', 'pos.access'], title: 'Room service', description: 'Room-service orders from the restaurant kitchen: preparing, delivery and tray clearing.' },
  { href: '/admin/hotel/night-audit', label: 'Night audit', icon: Moon, permission: 'hotel.folios', title: 'Night audit', description: 'Pre-audit checklist, room-night posting and the daily close of the hotel business date.' },
  { href: '/admin/hotel/reports', label: 'Hotel reports', icon: BarChart3, permission: 'hotel.reports', title: 'Hotel reports', description: 'Front office, rooms, revenue, ledgers, packages and guest spend, with CSV and print.' },
  { href: '/admin/hotel/channels', label: 'Booking channels', icon: Share2, permission: ['hotel.setup', 'hotel.front_desk'], title: 'Booking channels', description: 'Booking.com, Airbnb and channel-manager sync, with a queue for conflicts.' },
  { href: '/admin/hotel/meal-plans', label: 'Meal plans & minibar', icon: UtensilsCrossed, permission: 'hotel.setup', title: 'Meal plans & minibar', description: 'Rate plans with daily meal allowances, and the minibar catalog linked to inventory.' },
  { href: '/admin/hotel/room-setup', label: 'Rooms & categories', icon: LayoutGrid, permission: 'hotel.setup', title: 'Rooms & categories', description: 'Room categories with their price and capacity, and every room in the hotel.' },
];

export const hotelPageFor = (pathname) => HOTEL_PAGES.find((p) => p.href === pathname) || HOTEL_PAGES[0];
