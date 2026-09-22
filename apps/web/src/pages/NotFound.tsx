import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CARD_MOTION } from '../theme/cardStyle.js';
import { AVATAR_ART } from '../theme/avatars.js';
import { suitVars } from '../theme/suits.js';

/**
 * The 404.
 *
 * The visitor from the space suit, adrift between two planets. It is the one
 * screen in the app where nothing useful can be shown, so it is the one place
 * the delight budget is worth spending: a player sees it rarely, and never
 * while a clock is running.
 *
 * The drawing is the same stamp used for the avatar, not a second illustration
 * of an alien, so there is only ever one of these to keep in step.
 */

/** Saturn, small. Two of them, at different sizes and drift speeds. */
function Planet({ size, className, style }: { size: number; className: string; style: React.CSSProperties }) {
  return (
    <span aria-hidden="true" className={className} style={style}>
      <svg viewBox="0 0 24 24" width={size} height={size}>
        <circle cx="12" cy="12" r="5.4" fill="currentColor" />
        <ellipse
          cx="12"
          cy="12"
          rx="10.4"
          ry="3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          transform="rotate(-22 12 12)"
        />
      </svg>
    </span>
  );
}

export function NotFound(): JSX.Element {
  const { t } = useTranslation();
  const drift = CARD_MOTION ? 'drift' : '';

  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center"
      style={suitVars('space')}
    >
      {/* The reserve is generous on purpose: these drift, and a tight box
          would clip them at the top of the loop. */}
      <div className="relative h-32 w-64" aria-hidden="true">
        <span
          className={`absolute left-1/2 top-6 -translate-x-1/2 ${drift}`}
          style={{ color: 'rgb(var(--cat))' }}
        >
          <svg viewBox="0 0 24 24" width="76" height="76">
            {AVATAR_ART['space-visitor'].draw}
          </svg>
        </span>
        <Planet
          size={34}
          className={`absolute left-2 top-2 ${drift} drift-slow`}
          style={{ color: 'rgb(var(--cat))', opacity: 0.5 }}
        />
        <Planet
          size={24}
          className={`absolute right-3 top-20 ${drift}`}
          style={{ color: 'rgb(var(--cat))', opacity: 0.38 }}
        />
      </div>

      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {t('notFound.title')}
        </h1>
        <p className="mx-auto mt-2 max-w-[38ch] text-sm text-muted">{t('notFound.body')}</p>
      </div>

      <Link
        to="/"
        className="press rounded-lg border border-spot bg-spot px-4 py-2.5 text-sm font-medium text-surface"
      >
        {t('notFound.home')}
      </Link>
    </div>
  );
}
