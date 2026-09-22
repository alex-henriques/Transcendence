import { Component, type ErrorInfo, type ReactNode } from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';

/**
 * The last line before a white screen.
 *
 * Without one of these a single thrown render turns the whole app into a blank
 * page with the error only in the console, which is indistinguishable from the
 * site being down. React offers no hook equivalent, so this is the one class
 * component in the codebase.
 *
 * It deliberately does not try to recover in place. A component that threw
 * once will usually throw again on the same state, so the way out is a reload,
 * which is also the only honest thing to offer someone whose interface just
 * stopped working.
 */
interface Props extends WithTranslation {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

class Boundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console has to stay clean in normal operation, and this is not
    // normal operation: if the app has broken, the stack is the whole point.
    console.error('[wkb] render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { t } = this.props;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-4 text-center">
        {/* Three cards on the table at broken angles, drawn from the same
            card face the game uses rather than from a picture of one. */}
        <div aria-hidden="true" className="relative h-32 w-48">
          <span className="card-face absolute left-0 top-5 h-28 w-20 -rotate-[21deg]" />
          <span className="card-face absolute left-14 top-1 h-28 w-20 rotate-[5deg]" />
          <span className="card-face absolute left-28 top-7 h-28 w-20 rotate-[23deg]" />
        </div>

        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{t('crash.title')}</h1>
          <p className="mx-auto mt-2 max-w-[42ch] text-sm text-muted">{t('crash.body')}</p>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="press rounded-lg border border-spot bg-spot px-4 py-2.5 text-sm font-medium text-surface"
        >
          {t('crash.reload')}
        </button>
      </div>
    );
  }
}

export const ErrorBoundary = withTranslation()(Boundary);
