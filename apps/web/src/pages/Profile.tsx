import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AVATAR_MAX_BYTES,
  LOCALES,
  LOCALE_LABELS,
  changePasswordSchema,
  deleteAccountSchema,
  fieldErrors,
  presetToStored,
  updateProfileSchema,
  type AvatarPreset,
  type Locale,
} from '@wkb/shared';
import { ApiError, api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { currentLocale, setLocale } from '../i18n/index.js';
import { Alert, Avatar, Button, Field, PageTitle } from '../components/ui.js';
import { AvatarPicker } from '../components/AvatarPicker.js';

/**
 * Everything on this page is staged and applied on Save.
 *
 * It used to be half a form: the display name waited for the button, while
 * picking an avatar or a language took effect the moment it was clicked. A
 * Save button that only saves some of the controls above it is worse than no
 * Save button, because it tells the player their other changes are pending
 * when those have already been written. So the avatar and the language now
 * wait too, and the button is disabled until something has actually changed.
 *
 * The header's language switcher is untouched and still immediate. That one is
 * a global control with no form around it, and nothing there implies a Save.
 */

/** A pending avatar change; `none` means the stored one is kept. */
type AvatarChange =
  | { kind: 'none' }
  | { kind: 'preset'; preset: AvatarPreset | null }
  | { kind: 'file'; file: File; preview: string }
  | { kind: 'remove' };

export function Profile(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { user, patchUser } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [locale, setPendingLocale] = useState<Locale>(currentLocale());
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: 'none' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dataErrors, setDataErrors] = useState<Record<string, string>>({});
  const [dataProblem, setDataProblem] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // An object URL for a picked file is a live handle on the blob, so it is
  // released when it stops being the pending choice or the page goes away.
  const preview = avatar.kind === 'file' ? avatar.preview : null;
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  if (!user) return <></>;

  /** What the avatar would be if Save were pressed now. */
  const stagedAvatarUrl = ((): string | null => {
    switch (avatar.kind) {
      case 'preset':
        return avatar.preset === null ? null : presetToStored(avatar.preset);
      case 'file':
        return avatar.preview;
      case 'remove':
        return null;
      case 'none':
        return user.avatarUrl;
    }
  })();

  const dirty =
    displayName !== user.displayName || locale !== user.locale || avatar.kind !== 'none';

  const discard = () => {
    setDisplayName(user.displayName);
    setPendingLocale(currentLocale());
    setAvatar({ kind: 'none' });
    setErrors({});
    setProblem(null);
    setNotice(null);
  };

  const pickFile = (file: File) => {
    setProblem(null);
    setNotice(null);
    // Checked here for a fast, friendly message; the server sniffs the actual
    // bytes and re-checks the size, because this check is only a courtesy.
    if (file.size > AVATAR_MAX_BYTES) {
      setProblem('error.avatar.tooLarge');
      return;
    }
    setAvatar({ kind: 'file', file, preview: URL.createObjectURL(file) });
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    setProblem(null);

    const parsed = updateProfileSchema.safeParse({ displayName, locale });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);

    try {
      // The avatar first, because it is the part that can fail on its own
      // terms — an unreadable file, a type the server refuses — and a failure
      // there should not leave the name and the language half applied.
      let avatarUrl: string | null | undefined;

      if (avatar.kind === 'file') {
        const body = new FormData();
        body.append('avatar', avatar.file);
        const result = await api.upload<{ avatarUrl: string }>('/api/users/me/avatar', body);
        avatarUrl = result.avatarUrl;
      } else if (avatar.kind === 'remove') {
        await api.del('/api/users/me/avatar');
        avatarUrl = null;
      }

      const payload = {
        ...parsed.data,
        ...(avatar.kind === 'preset' ? { avatarPreset: avatar.preset } : {}),
      };
      const result = await api.patch<{ user: { avatarUrl: string | null } }>(
        '/api/users/me',
        payload,
      );
      if (avatar.kind === 'preset') avatarUrl = result.user.avatarUrl;

      patchUser({
        displayName: parsed.data.displayName ?? displayName,
        locale,
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      });
      // Only now, once the account carries it, does the interface change.
      if (locale !== currentLocale()) setLocale(locale);
      setAvatar({ kind: 'none' });
      setNotice('profile.displayNameUpdated');
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setProblem(error.code);
      } else setProblem('error.internal');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordNotice(null);
    setPasswordProblem(null);

    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setPasswordErrors(fieldErrors(parsed.error));
      return;
    }
    setPasswordErrors({});

    try {
      await api.post('/api/auth/password', parsed.data);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordNotice('auth.passwordChanged');
    } catch (error) {
      if (error instanceof ApiError) {
        setPasswordErrors(error.fields);
        setPasswordProblem(error.code);
      } else setPasswordProblem('error.internal');
    }
  };

  /** Module 15: everything the account holds, as one readable JSON document. */
  const exportData = async () => {
    setDataProblem(null);
    setExporting(true);
    try {
      await api.download('/api/users/me/export', 'wkb-data.json');
    } catch (error) {
      setDataProblem(error instanceof ApiError ? error.code : 'error.internal');
    } finally {
      setExporting(false);
    }
  };

  /** Module 15: erasure. Irreversible, so it asks twice and re-authenticates. */
  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    setDataProblem(null);

    const parsed = deleteAccountSchema.safeParse({
      confirm: confirmName,
      ...(user.hasPassword ? { password: confirmPassword } : {}),
    });
    if (!parsed.success) {
      setDataErrors(fieldErrors(parsed.error));
      return;
    }
    setDataErrors({});
    setClosing(true);

    try {
      await api.del('/api/users/me', parsed.data);
      // The session is gone with the account, so this leaves through the front
      // door rather than letting a protected route discover it the hard way.
      window.location.assign('/');
    } catch (error) {
      if (error instanceof ApiError) {
        setDataErrors(error.fields);
        setDataProblem(error.code);
      } else setDataProblem('error.internal');
      setClosing(false);
    }
  };

  const joined = new Date(user.createdAt).toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const progress = Math.round((user.xpIntoLevel / user.xpForNextLevel) * 100);

  return (
    <div className="mx-auto max-w-2xl animate-fade-up space-y-6">
      <PageTitle title={t('profile.title')} />

      <div className="panel-pad">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={user.displayName} src={user.avatarUrl} size={80} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-ink">{user.displayName}</h2>
            <p className="text-sm text-muted">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted">{t('profile.memberSince', { date: joined })}</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
            <span>
              {t('common.level')} {user.level}
            </span>
            <span className="tabular-nums">
              {t('profile.toNextLevel', {
                into: user.xpIntoLevel,
                needed: user.xpForNextLevel,
                level: user.level + 1,
              })}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden bg-surface-2"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-spot transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <form className="panel-pad space-y-5" onSubmit={(event) => void saveProfile(event)} noValidate>
        <h2 className="text-sm font-semibold text-muted">{t('profile.editTitle')}</h2>

        {problem && <Alert>{t(problem)}</Alert>}
        {notice && <Alert tone="success">{t(notice)}</Alert>}

        {/* Avatar ------------------------------------------------------- */}
        <div>
          <span className="label">{t('profile.avatar')}</span>
          <div className="flex flex-wrap items-center gap-4">
            {/* The preview is what Save would store, not what is stored. */}
            <Avatar name={displayName || user.displayName} src={stagedAvatarUrl} size={56} />
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) pickFile(file);
                  event.target.value = '';
                }}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                {t('profile.uploadAvatar')}
              </Button>
              {stagedAvatarUrl && (
                <Button variant="ghost" onClick={() => setAvatar({ kind: 'remove' })}>
                  {t('profile.removeAvatar')}
                </Button>
              )}
            </div>
          </div>
          <p className="hint">{t('profile.avatarHint')}</p>

          <div className="mt-4">
            <h3 className="section-title">{t('profile.avatarChoose')}</h3>
            <p className="mb-3 text-sm text-muted">{t('profile.avatarChooseHint')}</p>
            <AvatarPicker
              value={stagedAvatarUrl}
              displayName={displayName || user.displayName}
              disabled={busy}
              onChange={(preset) => setAvatar({ kind: 'preset', preset })}
            />
          </div>
        </div>

        <Field
          label={t('auth.displayName')}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={errors.displayName}
          maxLength={24}
        />

        {/* Language. Staged, unlike the one in the header. --------------- */}
        <div>
          <span className="label">{t('common.language')}</span>
          <div
            className="flex w-fit rounded-lg border border-rule-strong bg-surface p-0.5"
            role="group"
            aria-label={t('common.language')}
          >
            {LOCALES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPendingLocale(option)}
                aria-pressed={option === locale}
                title={LOCALE_LABELS[option]}
                className={[
                  'rounded-md px-2.5 py-1.5 text-xs font-medium uppercase transition',
                  option === locale
                    ? 'bg-spot text-surface'
                    : 'text-muted hover:bg-surface-2 hover:text-ink',
                ].join(' ')}
              >
                {option === 'pt-BR' ? 'PT' : option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
          <Button type="submit" loading={busy} disabled={!dirty}>
            {t('common.save')}
          </Button>
          {dirty && (
            <>
              <Button variant="ghost" onClick={discard}>
                {t('common.discard')}
              </Button>
              <span className="text-xs text-muted">{t('profile.unsaved')}</span>
            </>
          )}
        </div>
      </form>

      {user.hasPassword && (
        <form className="panel-pad space-y-4" onSubmit={(event) => void changePassword(event)} noValidate>
          <h2 className="text-sm font-semibold text-muted">
            {t('profile.security')}
          </h2>

          {passwordProblem && <Alert>{t(passwordProblem)}</Alert>}
          {passwordNotice && <Alert tone="success">{t(passwordNotice)}</Alert>}

          <Field
            label={t('auth.currentPassword')}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            error={passwordErrors.currentPassword}
          />
          <Field
            label={t('auth.newPassword')}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={passwordErrors.newPassword}
            hint={t('auth.passwordHint')}
          />

          <Button type="submit" variant="secondary">
            {t('auth.changePassword')}
          </Button>
        </form>
      )}

      {/* Your data (module 15) ------------------------------------------- */}
      <div className="panel-pad space-y-4">
        <h2 className="text-sm font-semibold text-muted">{t('profile.dataTitle')}</h2>

        {dataProblem && <Alert>{t(dataProblem)}</Alert>}

        <div>
          <p className="text-sm text-ink">{t('profile.exportBody')}</p>
          <Button
            variant="secondary"
            className="mt-3"
            loading={exporting}
            onClick={() => void exportData()}
          >
            {t('profile.exportAction')}
          </Button>
        </div>

        <div className="border-t border-rule pt-4">
          <p className="text-sm text-ink">{t('profile.deleteBody')}</p>

          {!deleteOpen ? (
            <Button variant="danger" className="mt-3" onClick={() => setDeleteOpen(true)}>
              {t('profile.deleteAction')}
            </Button>
          ) : (
            <form
              className="mt-3 space-y-3 rounded-xl border border-wrong/40 bg-wrong-wash p-4"
              onSubmit={(event) => void deleteAccount(event)}
              noValidate
            >
              <p className="text-sm font-semibold text-wrong">{t('profile.deleteWarning')}</p>
              <Field
                label={t('profile.deleteConfirmLabel', { name: user.displayName })}
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                error={dataErrors.confirm}
                autoComplete="off"
              />
              {user.hasPassword && (
                <Field
                  label={t('auth.currentPassword')}
                  type="password"
                  autoComplete="current-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  error={dataErrors.password}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" loading={closing}>
                  {t('profile.deleteFinal')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDeleteOpen(false);
                    setConfirmName('');
                    setConfirmPassword('');
                    setDataErrors({});
                    setDataProblem(null);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
