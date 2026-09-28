/**
 * Thin fetch wrapper.
 *
 * The access token lives in memory only, never in localStorage where any
 * injected script could read it. Persistence is handled by the httpOnly
 * refresh cookie, which JavaScript cannot touch.
 */

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(value: string | null): void {
  accessToken = value;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onSessionExpired(handler: () => void): void {
  onSessionLost = handler;
}

export interface ApiErrorBody {
  code: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.code);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? {};
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as { error?: ApiErrorBody };
    if (payload.error?.code) return new ApiError(response.status, payload.error);
  } catch {
    // Non-JSON error body (a proxy error page, for instance).
  }
  return new ApiError(response.status, { code: 'error.internal' });
}

/** Exchanges the refresh cookie for a new access token. At most one in flight. */
async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { accessToken: string };
      accessToken = payload.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all see this result.
      queueMicrotask(() => {
        refreshing = null;
      });
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set for multipart uploads, where the browser must pick the boundary. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Internal: prevents a refresh loop. */
  retry?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiError(0, { code: 'error.network' });
  }

  // One silent refresh, then one retry. A second 401 means the session is gone.
  // The auth endpoints are excluded: refreshing in response to a failed
  // refresh would just make the same request twice.
  const isAuthEndpoint = path.startsWith('/api/auth/refresh') || path.startsWith('/api/auth/session');
  if (response.status === 401 && !options.retry && !isAuthEndpoint) {
    const renewed = await refreshSession();
    if (renewed) return request<T>(path, { ...options, retry: true });
    accessToken = null;
    onSessionLost?.();
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', formData }),
  /**
   * Fetches a file and hands it to the browser as a download.
   *
   * A plain `<a download>` cannot be used: the export is behind the access
   * token, which lives in memory and never in a URL, so the request has to go
   * through `request` like any other and the response is turned into a blob
   * here. The object URL is revoked immediately; the download has already
   * started by then.
   */
  download: async (path: string, fallbackName: string): Promise<void> => {
    const send = () => {
      const headers: Record<string, string> = {};
      if (accessToken)
        headers.Authorization = `Bearer ${accessToken}`;
      return fetch(path, { headers, credentials: 'same-origin' });
    };
    let response = await send();
    if (response.status === 401 && (await refreshSession()))
      response = await send();
    if (!response.ok)
      throw await parseError(response);
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const named = /filename="([^"]+)"/.exec(disposition);

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = named?.[1] ?? fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
