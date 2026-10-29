'use client';

/** Inline field error under an input */
export default function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

export function inputErrorClass(hasError, base = '') {
  return `${base} ${hasError ? 'border-red-400 focus:ring-red-500 focus:border-red-500' : ''}`.trim();
}
