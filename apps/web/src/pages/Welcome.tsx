import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { CARD_MOTION } from '../theme/cardStyle.js';
import { SUITS, suitVars } from '../theme/suits.js';

/**
 * The front of the house.
 *
 * The first version of this page explained the game in three equal boxes and
 * then listed its features in four more. It was accurate and completely inert:
 * a reader learned that cards are dealt and answered without ever seeing one.
 *
 * So the page deals instead. The hero is a hand of real cards, and the section
 * under it is a live card the visitor can actually answer, which teaches the
 * one rule worth teaching before signing up: green means you were right, and
 * what the statement turned out to be is told separately, in its own colour.
 *
 * Every drawing here is the game's own: the same `.card-face`, the same eight
 * suits. Nothing is a picture of the product, so nothing can go stale when the
 * product changes.
 */

/** A card face, as the game paints it, at whatever size the layout gives it. */
function Card({
  slug,
  statement,
  index = '01',
  className = '',
  style,
  dimmed = false,
}: {
  slug: string;
  statement: string;
  index?: string;
  className?: string;
  style?: React.CSSProperties;
  dimmed?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const suit = SUITS[slug];

  return (
    <article
      className={`card-face flex items-center px-5 py-8 sm:px-7 ${dimmed ? 'opacity-70' : ''} ${className}`}
      style={{ ...suitVars(slug), ...style }}
    >
      <span aria-hidden="true" className="card-band" />
      <span aria-hidden="true" className="card-keyline" />
      <span
        aria-hidden="true"
        className="absolute left-4 top-4 flex flex-col items-center gap-0.5 text-[10px] font-bold tracking-[0.08em]"
        style={{ color: 'rgb(var(--cat))' }}
      >
        {index}
        {suit?.pip(11)}
      </span>

      <div className="relative flex w-full flex-col items-center">
        <span aria-hidden="true" className="mb-2.5" style={{ color: 'rgb(var(--cat))' }}>
          {suit?.crest(34)}
        </span>
        <p
          className="mb-3 text-[9px] font-bold uppercase tracking-[0.2em]"
          style={{ color: 'rgb(var(--cat))' }}
        >
          {t(`categories.${slug}`)}
        </p>
        <p
          className="text-balance text-center text-xl font-semibold leading-[1.15] tracking-[-0.02em] sm:text-2xl"
          style={{ color: 'rgb(var(--card-ink))' }}
        >
          {statement}
        </p>
      </div>
    </article>
  );
}

/**
 * The hand. Three cards squared off behind each other rather than fanned:
 * a stack on a table does not splay unless something pushes it, and the two
 * underneath are there to say "there are more of these", not to be read.
 */
function Hand(): JSX.Element {
  const { t } = useTranslation();

  return (
    /* The two cards underneath are inset by the wrapper's own padding, not
       `inset-0`. An absolutely positioned child fills the padding box, so
       under `inset-0` they were already the full width of the wrapper before
       being nudged and turned, and the reserved space reserved nothing. A
       rotation also sweeps its corners outward, which is why the reserve is
       wider than the offsets alone would suggest. */
    <div className="relative mx-auto w-full max-w-[25rem] pb-12 pr-12 lg:mr-0">
      <div
        aria-hidden="true"
        className="card-face absolute bottom-12 left-0 right-12 top-0 translate-x-5 translate-y-6 rotate-[4deg] opacity-70"
        style={suitVars('geography')}
      >
        <span className="card-band" />
      </div>
      <div
        aria-hidden="true"
        className="card-face absolute bottom-12 left-0 right-12 top-0 translate-x-2.5 translate-y-3 rotate-[2deg] opacity-85"
        style={suitVars('history')}
      >
        <span className="card-band" />
      </div>
      <Card
        slug="space"
        statement={t('welcome.heroCard')}
        className={`relative min-h-[17rem] sm:min-h-[19rem] ${CARD_MOTION ? 'deal-in' : ''}`}
      />
    </div>
  );
}

/**
 * The eight cards the demonstration deals from, one per suit.
 *
 * Half are true and half are myths on purpose. A demo that is always a myth
 * teaches the visitor to press Myth, which is the opposite of the game.
 */
const DEMO = [
  { slug: 'science', isTrue: false, index: '07' },
  { slug: 'space', isTrue: true, index: '12' },
  { slug: 'history', isTrue: false, index: '23' },
  { slug: 'sports', isTrue: true, index: '04' },
  { slug: 'geography', isTrue: false, index: '31' },
  { slug: 'arts', isTrue: true, index: '18' },
  { slug: 'technology', isTrue: false, index: '09' },
  { slug: 'culture', isTrue: true, index: '26' },
] as const;

/** The demonstration: one card, two buttons, and the verdict the game gives. */
function TryIt(): JSX.Element {
  const { t } = useTranslation();
  const [dealt, setDealt] = useState(0);
  const [answer, setAnswer] = useState<'truth' | 'myth' | null>(null);

  // Deal in order and wrap, so a visitor who keeps pressing sees all eight
  // suits and never the same card twice in a row.
  const card = DEMO[dealt % DEMO.length]!;
  const correct = answer === (card.isTrue ? 'truth' : 'myth');

  const deal = () => {
    setDealt((n) => n + 1);
    setAnswer(null);
  };

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_minmax(0,24rem)] md:items-center md:gap-10">
      <Card
        /* Keyed on the deal so React rebuilds the face and the deal animation
           runs again; without it the statement swaps inside a card that never
           moved, and nothing looks dealt. */
        key={dealt}
        slug={card.slug}
        statement={t(`welcome.cards.${card.slug}.statement`)}
        index={card.index}
        className={CARD_MOTION ? 'deal-in' : ''}
        dimmed={answer !== null}
      />

      <div>
        {answer === null ? (
          <>
            <p className="mb-4 text-sm text-muted">{t('welcome.tryPrompt')}</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setAnswer('truth')}
                className="press rounded border border-truth/40 bg-surface px-5 py-4 text-left text-xl font-semibold text-truth"
              >
                {t('match.truth')}
              </button>
              <button
                type="button"
                onClick={() => setAnswer('myth')}
                className="press rounded border border-myth/40 bg-surface px-5 py-4 text-left text-xl font-semibold text-myth"
              >
                {t('match.myth')}
              </button>
            </div>
          </>
        ) : (
          <div
            className={[
              'stamp rounded border-2 px-5 py-5',
              correct ? 'border-correct bg-correct-wash' : 'border-wrong bg-wrong-wash',
            ].join(' ')}
          >
            <p className={`text-2xl font-semibold ${correct ? 'text-correct' : 'text-wrong'}`}>
              {t(correct ? 'match.correct' : 'match.wrong')}
            </p>
            {/* Green or red says whether you were right. This line, always in
                the answer pair's colours, says what the statement was. */}
            <p
              className={`mt-1.5 text-sm font-semibold uppercase tracking-[0.08em] ${
                card.isTrue ? 'text-truth' : 'text-myth'
              }`}
            >
              {t(card.isTrue ? 'match.itWasTrue' : 'match.itWasFalse')}
            </p>
            <p className="mt-3 border-t border-current/20 pt-3 text-base leading-snug text-ink">
              <span className="mr-1.5 text-xs font-medium text-muted">{t('match.inFact')}</span>
              {t(`welcome.cards.${card.slug}.fact`)}
            </p>
            <button
              type="button"
              onClick={deal}
              className="press mt-4 rounded-lg border border-rule-strong bg-surface px-3 py-2 text-sm text-ink"
            >
              {t('welcome.tryAgain')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const DECK = ['sports', 'history', 'science', 'space', 'technology', 'arts', 'geography', 'culture'];

export function Welcome(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();

  const cta = (
    <Link
      to={user ? '/play' : '/signup'}
      className="press inline-flex rounded-lg border border-spot bg-spot px-5 py-3 text-sm font-medium text-surface"
    >
      {user ? t('welcome.ctaPlay') : t('welcome.ctaSignup')}
    </Link>
  );

  return (
    <div className="space-y-16 sm:space-y-24">
      {/* 1. Hero: split, copy left, the hand right. -------------------------- */}
      <section className="grid items-center gap-12 pt-2 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
        <div className="animate-fade-up">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-spot">
            {t('welcome.eyebrow')}
          </p>
          <h1 className="mt-3 text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.035em] text-ink sm:text-7xl">
            {t('app.name')}
          </h1>
          <p className="mt-5 max-w-[34ch] text-lg leading-snug text-ink-soft sm:text-xl">
            {t('welcome.lead')}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            {cta}
            {!user && (
              <Link to="/login" className="press rounded-lg px-2 py-3 text-sm font-medium text-ink underline decoration-rule-strong underline-offset-4">
                {t('welcome.ctaLogin')}
              </Link>
            )}
          </div>
        </div>

        <Hand />
      </section>

      {/* 2. A card you can actually answer. --------------------------------- */}
      <section>
        <h2 className="mb-2 text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {t('welcome.tryTitle')}
        </h2>
        <p className="mb-8 max-w-[52ch] text-sm leading-relaxed text-muted">
          {t('welcome.tryLead')}
        </p>
        <TryIt />
      </section>

      {/* 3. The deck, as a strip you scroll rather than a grid. -------------- */}
      <section>
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {t('welcome.deckTitle')}
        </h2>
        <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">{t('welcome.deckLead')}</p>

        <ul className="-mx-4 mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 lg:mx-0 lg:grid lg:grid-cols-8 lg:overflow-visible lg:px-0 lg:pb-0">
          {DECK.map((slug) => (
            <li
              key={slug}
              className="flex w-[8.5rem] shrink-0 snap-start flex-col items-center gap-3 rounded-lg border border-card-edge px-3 py-6 text-center lg:w-auto"
              style={{ ...suitVars(slug), background: 'rgb(var(--card))' }}
            >
              <span aria-hidden="true" style={{ color: 'rgb(var(--cat))' }}>
                {SUITS[slug]?.crest(34)}
              </span>
              <span
                className="text-[10px] font-bold uppercase leading-tight tracking-[0.1em]"
                style={{ color: 'rgb(var(--cat))' }}
              >
                {t(`categories.${slug}`)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 4. The rest of the box: one tall claim, two short ones. ------------- */}
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel-pad flex flex-col justify-between gap-8 lg:p-8">
          <div>
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {t('welcome.roomTitle')}
            </h2>
            <p className="mt-3 max-w-[46ch] text-base leading-relaxed text-ink-soft">
              {t('welcome.roomBody')}
            </p>
          </div>
          {/* The invite code, set the way the room sets it. This is the
              object the paragraph is describing, so it is worth showing
              rather than describing again in a large number. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="data rounded border border-rule-strong bg-surface-2 px-4 py-2.5 text-3xl font-semibold tracking-[0.18em] text-ink sm:text-4xl">
              {t('welcome.roomCode')}
            </span>
            <span className="text-sm text-muted">{t('welcome.roomSeats')}</span>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="panel-pad">
            <h3 className="text-lg font-semibold text-ink">{t('welcome.recordTitle')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t('welcome.recordBody')}</p>
          </div>
          <div className="panel-pad" style={suitVars('arts')}>
            <h3 className="text-lg font-semibold text-ink">{t('welcome.languagesTitle')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t('welcome.languagesBody')}</p>
            <p className="data mt-3 text-xs uppercase tracking-[0.14em] text-spot">
              {t('welcome.languagesList')}
            </p>
          </div>
        </div>
      </section>

      {/* 5. Closing: the title, asked back. --------------------------------- */}
      <section className="border-t border-rule pt-12">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="max-w-[16ch] text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.03em] text-ink sm:text-6xl">
            {t('welcome.closingTitle')}
          </h2>
          {cta}
        </div>
      </section>
    </div>
  );
}
