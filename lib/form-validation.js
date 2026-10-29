/**
 * Shared form helpers — human-friendly validation for POS forms.
 */

export function digitsOnly(value = '') {
  return String(value).replace(/\D/g, '');
}

export function numbersOnlyInput(value = '', { allowDecimal = false } = {}) {
  if (allowDecimal) {
    let cleaned = String(value).replace(/[^\d.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) cleaned = `${parts[0]}.${parts.slice(1).join('')}`;
    return cleaned;
  }
  return String(value).replace(/\D/g, '');
}

export function validateRequired(value, label = 'This field') {
  if (value == null || String(value).trim() === '') {
    return `Please enter ${label.toLowerCase()}.`;
  }
  return null;
}

export function validatePhone(phone, { required = true } = {}) {
  const digits = digitsOnly(phone);
  if (!digits) {
    return required ? 'Please enter a phone number.' : null;
  }
  if (/[a-zA-Z]/.test(String(phone))) {
    return 'Phone number should only contain digits — no letters.';
  }
  if (digits.length < 10) {
    return 'Phone number should be at least 10 digits.';
  }
  if (digits.length > 15) {
    return 'That phone number looks too long. Please check it.';
  }
  return null;
}

export function validateEmail(email, { required = false } = {}) {
  const value = String(email || '').trim();
  if (!value) return required ? 'Please enter an email address.' : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'Please enter a valid email address (like name@email.com).';
  }
  return null;
}

export function validatePositiveNumber(value, label = 'amount', { allowZero = true, required = true } = {}) {
  if (value === '' || value == null) {
    return required ? `Please enter a ${label}.` : null;
  }
  if (typeof value === 'string' && /[a-zA-Z]/.test(value)) {
    return `${label[0].toUpperCase()}${label.slice(1)} should be a number, not letters.`;
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return `Please enter a valid ${label}.`;
  }
  if (n < 0) {
    return `${label[0].toUpperCase()}${label.slice(1)} cannot be negative.`;
  }
  if (!allowZero && n === 0) {
    return `Please enter a ${label} greater than zero.`;
  }
  return null;
}

export function validateName(name, label = 'name') {
  const value = String(name || '').trim();
  if (!value) return `Please enter the ${label}.`;
  if (value.length < 2) return `${label[0].toUpperCase()}${label.slice(1)} is too short.`;
  if (/^\d+$/.test(value)) return `${label[0].toUpperCase()}${label.slice(1)} cannot be only numbers.`;
  return null;
}

export function validatePin(pin) {
  const digits = digitsOnly(pin);
  if (!digits) return 'Please enter a PIN.';
  if (/[a-zA-Z]/.test(String(pin))) return 'PIN should only contain numbers.';
  if (digits.length !== 4) return 'PIN must be exactly 4 digits.';
  return null;
}

export function firstError(errors = {}) {
  return Object.values(errors).find(Boolean) || null;
}
