import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { Spinner } from '../components/ui.js';

/**
 * Where the OAuth provider's callback lands the browser.
 *
 * The token never travels in the URL: the API set the refresh cookie before
 * redirecting here, so all this page does is exchange it for an access token
 * the same way a returning visitor would.
 */
export function AuthCallback(): JSX.Element {
  const { t } = useTranslation();
  const { restore } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      const ok = await restore();
      if (ok) navigate('/play', { replace: true });
      else setFailed(true);
    })();
  }, [restore, navigate]);

  useEffect(() => {
    if (!failed) return undefined;
    const timer = window.setTimeout(() => navigate('/login?oauth_error=session', { replace: true }), 1200);
    return () => window.clearTimeout(timer);
  }, [failed, navigate]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted">
      <Spinner className="h-6 w-6" />
      <p className="text-sm">{failed ? t('auth.oauthFailed') : t('auth.signingIn')}</p>
    </div>
  );
}
