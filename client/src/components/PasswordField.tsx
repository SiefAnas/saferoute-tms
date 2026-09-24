import { useState } from 'react'
import { Field, FIELD_CLASS } from './Input'
import { PasswordStrengthMeter } from './PasswordStrengthMeter'

// Password input with a show/hide toggle, the rules line and the strength meter. Used wherever
// someone chooses a new password (first-login set password, reset password).
export function PasswordField({
  label,
  value,
  onChange,
  required = false,
  hint = 'At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.',
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  hint?: string
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <Field label={label}>
      <span className="relative flex items-center">
        <input
          type={show ? 'text' : 'password'}
          required={required}
          minLength={8}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${FIELD_CLASS} pr-10`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-row text-muted hover:text-ink"
        >
          <span className="material-symbols-outlined !text-[18px]">{show ? 'visibility_off' : 'visibility'}</span>
        </button>
      </span>
      <span className="text-[12px] font-normal text-muted">{hint}</span>
      <PasswordStrengthMeter password={value} />
    </Field>
  )
}
