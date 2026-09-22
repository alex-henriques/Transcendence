import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { presetFromStored } from '@wkb/shared';
import { AVATAR_ART } from '../theme/avatars.js';
import { suitVars } from '../theme/suits.js';

/** A small set of primitives, so every screen looks like the same product. */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'truth' | 'myth';

/**
 * Every variant is a solid fill with a solid border. The hover state is a
 * brightness step from `.press` rather than a second colour, so a control
 * announces itself the same way everywhere and a new variant cannot forget to.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'border border-spot bg-spot text-surface',
  secondary: 'border border-rule-strong bg-surface text-ink',
  ghost: 'border border-transparent bg-transparent text-ink-soft hover:bg-surface-2',
  danger: 'border border-wrong bg-surface text-wrong',
  truth: 'border border-truth bg-truth text-surface font-semibold',
  myth: 'border border-myth bg-myth text-surface font-semibold',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={[
        // `press` is the project's own press idiom, a key going down, rather
        // than the scale-on-press of app UI. It lived only on the vote buttons.
        'press inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** An i18n key from the shared Zod schemas. */
  error?: string | undefined;
  hint?: string | undefined;
}

export function Field({ label, error, hint, id, className = '', ...rest }: FieldProps): JSX.Element {
  const { t } = useTranslation();
  const inputId = id ?? `field-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={className}>
      <label className="label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={`input ${error ? 'input-error' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <p className="error-text" id={`${inputId}-error`} role="alert">
          {t(error)}
        </p>
      ) : hint ? (
        <p className="hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success' | 'info';
  children: ReactNode;
}): JSX.Element {
  const tones = {
    error: 'border-wrong/40 bg-wrong-wash text-wrong',
    success: 'border-correct/40 bg-correct-wash text-correct',
    info: 'border-spot bg-spot-wash text-spot-strong',
  } as const;

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role="status">
      {children}
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Avatar with a generated fallback.
 *
 * The subject requires a default avatar when none is uploaded. Rather than
 * shipping one grey silhouette for everybody, the fallback derives a stable
 * hue from the display name, so players stay visually distinct in a scoreboard.
 */
export function Avatar({
  name,
  src,
  size = 40,
  className = '',
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}): JSX.Element {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toUpperCase();

  // A small fixed set of muted inks, picked deterministically from the name.
  // A generated hue wheel would drift into colours that fight the palette;
  // five hand-chosen tones stay inside it and still tell people apart.
  const TONES = ['#5b6b52', '#7a5c3a', '#4f5f70', '#6e4a4a', '#5a5468'] as const;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;

  // A stock avatar is stored in the same field as an uploaded one, so this is
  // the one place that has to know the difference. `presetFromStored` returns
  // null for anything we do not ship, which keeps a stale or tampered value
  // from ever reaching the renderer.
  const preset = presetFromStored(src);
  if (preset) {
    const art = AVATAR_ART[preset];
    return (
      <span
        aria-hidden="true"
        /* Card stock in both themes, like everything else printed in a suit
           colour. On the dark surface the suit colours measure 2.91:1, which
           fails the 3:1 that a graphic carrying meaning has to clear. */
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded border border-card-edge ${className}`}
        style={{ width: size, height: size, background: 'rgb(var(--card))', ...suitVars(art.suit) }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.82} height={size * 0.82} style={{ color: 'rgb(var(--cat))' }}>
          {art.draw}
        </svg>
      </span>
    );
  }

  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-sm border border-rule object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      /* `text-card`, not `text-surface`: the tones below are a fixed data
         palette that does not follow the theme, so the ink on them must not
         either. `text-surface` inverts, and inverted to dark it put dark ink
         on a dark tone. */
      className={`inline-flex shrink-0 items-center justify-center rounded font-semibold text-card ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: TONES[hash % TONES.length],
      }}
    >
      {initials || '?'}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="panel-pad text-center text-sm text-muted">{children}</div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}
