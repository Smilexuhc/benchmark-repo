import { useQuery, useQueryClient } from '@tanstack/react-query';

export type Session = { email: string } | null;

const SESSION_KEY = ['auth', 'session'] as const;

async function fetchJson<T>(
  url: string,
  init?: RequestInit & { allowStatuses?: number[] },
): Promise<{ status: number; body: T | null }> {
  const { allowStatuses, ...rest } = init ?? {};
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...rest,
  });
  if (!res.ok && !allowStatuses?.includes(res.status)) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const body = res.status === 204 ? null : ((await res.json()) as T);
  return { status: res.status, body };
}

export async function fetchSession(): Promise<Session> {
  const { status, body } = await fetchJson<{ session: Session }>('/api/auth/me', {
    method: 'GET',
    allowStatuses: [401],
  });
  if (status === 401) return null;
  return body?.session ?? null;
}

export async function loginRequest(email: string, password: string): Promise<void> {
  await fetchJson<{ ok: true }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutRequest(): Promise<void> {
  await fetchJson<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useAuthActions() {
  const qc = useQueryClient();
  return {
    async login(email: string, password: string) {
      await loginRequest(email, password);
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
    async logout() {
      await logoutRequest();
      qc.setQueryData(SESSION_KEY, null);
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  };
}

export const SESSION_QUERY_KEY = SESSION_KEY;
