import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuthActions, useSession } from '@/lib/auth-client';

type LoginSearch = { redirect: string | undefined };

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const r = search.redirect;
    return { redirect: typeof r === 'string' ? r : undefined };
  },
  component: LoginPage,
});

function safeRedirectTarget(value: string | undefined): string {
  if (!value) return '/characters';
  if (!value.startsWith('/') || value.startsWith('//')) return '/characters';
  if (value === '/login') return '/characters';
  return value;
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const session = useSession();
  const { login } = useAuthActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const target = safeRedirectTarget(redirect);
  const alreadyAuthed = session.data != null;

  useEffect(() => {
    if (alreadyAuthed) navigate({ to: target, replace: true });
  }, [alreadyAuthed, navigate, target]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate({ to: target, replace: true });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '登录失败，请检查邮箱与密码');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>使用管理员账号登录 Benchmark Admin</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium leading-none">
                邮箱
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium leading-none">
                密码
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '登录中…' : '登录'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
