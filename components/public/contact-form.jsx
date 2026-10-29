'use client';

import { useRef, useState } from 'react';
import { Send } from 'lucide-react';

/**
 * Public contact form. Posts to /api/public/inquiries, which lands the message
 * in the leads module at /admin/leads.
 *
 * The server is the authority on validity — it enforces the same three required
 * fields and is rate limited. The checks here exist only to save the visitor a
 * round trip, and the server's message wins whenever the two disagree.
 */

const EMPTY = { name: '', email: '', phone: '', subject: '', message: '' };

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Please enter your name.';
  if (!values.email.trim()) errors.email = 'Please enter your email.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = 'Please enter a valid email.';
  if (values.phone.trim() && values.phone.replace(/\D/g, '').length < 7) errors.phone = 'Please enter a valid phone number.';
  if (!values.message.trim()) errors.message = 'Please enter a message.';
  return errors;
}

export default function ContactForm() {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null); // { tone: 'ok' | 'error', text }
  const [submitting, setSubmitting] = useState(false);
  const statusRef = useRef(null);

  const update = (field) => (event) => {
    setValues((v) => ({ ...v, [field]: event.target.value }));
    // Clear a field's error as soon as the visitor starts fixing it.
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const found = validate(values);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setStatus(null);
      return;
    }

    setSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch('/api/public/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus({
          tone: 'error',
          text: data.error || 'We could not send your message. Please try again, or call us.',
        });
        return;
      }

      setValues(EMPTY);
      setStatus({ tone: 'ok', text: data.message || 'Message received. We will respond within 24 hours.' });
    } catch {
      setStatus({ tone: 'error', text: 'We could not reach the kitchen. Please check your connection, or call us.' });
    } finally {
      setSubmitting(false);
      // Move focus to the outcome so it is announced rather than missed.
      requestAnimationFrame(() => statusRef.current?.focus());
    }
  }

  const field = (name, label, { type = 'text', required = false, placeholder = '', Tag = 'input' } = {}) => (
    <div className="rc-field" data-invalid={errors[name] ? 'true' : undefined}>
      <label htmlFor={`contact-${name}`}>
        {label}
        {required ? <span className="rc-req" aria-hidden="true">*</span> : null}
      </label>
      <Tag
        id={`contact-${name}`}
        name={name}
        type={Tag === 'input' ? type : undefined}
        value={values[name]}
        onChange={update(name)}
        placeholder={placeholder}
        required={required}
        aria-required={required || undefined}
        aria-invalid={errors[name] ? 'true' : undefined}
        aria-describedby={errors[name] ? `contact-${name}-error` : undefined}
        className="dsp-focus"
        rows={Tag === 'textarea' ? 5 : undefined}
      />
      {errors[name] ? (
        <p className="rc-field-error" id={`contact-${name}-error`}>{errors[name]}</p>
      ) : null}
    </div>
  );

  return (
    <form className="rc-form" onSubmit={onSubmit} noValidate>
      <div className="rc-form-row">
        {field('name', 'Your name', { required: true, placeholder: 'Sushant Dhakal' })}
        {field('email', 'Email', { type: 'email', required: true, placeholder: 'you@example.com' })}
      </div>
      <div className="rc-form-row">
        {field('phone', 'Phone', { type: 'tel', placeholder: '98XXXXXXXX' })}
        {field('subject', 'Subject', { placeholder: 'Table booking, catering, feedback…' })}
      </div>
      {field('message', 'Message', { required: true, Tag: 'textarea', placeholder: 'How can we help?' })}

      <div className="rc-form-actions">
        <button type="submit" className="rc-btn rc-btn--wall dsp-focus" disabled={submitting}>
          <Send aria-hidden="true" />
          {submitting ? 'Sending…' : 'Send message'}
        </button>
        <p className="rc-form-note">We reply within 24 hours.</p>
      </div>

      <p
        className="rc-form-status"
        data-tone={status?.tone}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={statusRef}
        hidden={!status}
      >
        {status?.text}
      </p>
    </form>
  );
}
