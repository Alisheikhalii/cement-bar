'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, LogIn, Truck, Building2 } from 'lucide-react';
import { loginSchema, normalizeMobile, enDigits, type LoginInput, type MeResponse } from '@cb/shared';
import { Alert, Button3D, Field, Tabs, TextInput, fieldDescribedBy } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { api, errorMessage } from '@/lib/api';
import { ME_QUERY_KEY, ROLE_HOME } from '@/lib/auth';
import { faErrorMap } from '@/lib/zod-fa';
import { AuthCard } from './AuthCard';

type Mode = 'staff' | 'driver';

export function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('staff');
  const [showPw, setShowPw] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    clearErrors,
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema, { error: faErrorMap }),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const raw = enDigits(values.identifier.trim());
    const identifier = mode === 'driver' ? (normalizeMobile(raw) ?? raw) : raw;
    try {
      await api.post('/auth/login', { identifier, password: values.password });
      const me = await qc.fetchQuery({
        queryKey: ME_QUERY_KEY,
        queryFn: () => api.get<MeResponse>('/auth/me'),
        staleTime: 0,
      });
      router.replace(ROLE_HOME[me.role]);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  const idLabel = mode === 'driver' ? fa.auth.mobile : fa.auth.username;
  const idErr = errors.identifier?.message;
  const pwErr = errors.password?.message;

  return (
    <AuthCard title={fa.auth.loginTitle} subtitle={fa.auth.loginSubtitle}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-space-md">
        <Tabs
          aria-label={fa.auth.loginTitle}
          fullWidth
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode);
            setServerError(null);
            clearErrors();
          }}
          items={[
            { value: 'staff', label: fa.auth.staffTab, icon: <Building2 className="size-4" aria-hidden /> },
            { value: 'driver', label: fa.auth.driverTab, icon: <Truck className="size-4" aria-hidden /> },
          ]}
        />

        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

        <Field label={idLabel} htmlFor="identifier" required error={idErr}>
          <TextInput
            id="identifier"
            dir={mode === 'driver' ? 'ltr' : undefined}
            inputMode={mode === 'driver' ? 'tel' : 'text'}
            autoComplete={mode === 'driver' ? 'tel' : 'username'}
            placeholder={mode === 'driver' ? fa.auth.mobilePlaceholder : undefined}
            invalid={!!idErr}
            aria-describedby={fieldDescribedBy('identifier', idErr)}
            className={mode === 'driver' ? 'text-end' : undefined}
            {...register('identifier')}
          />
        </Field>

        <Field label={fa.auth.password} htmlFor="password" required error={pwErr}>
          <div className="relative">
            <TextInput
              id="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              invalid={!!pwErr}
              aria-describedby={fieldDescribedBy('password', pwErr)}
              className="pe-12"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? fa.auth.hidePassword : fa.auth.showPassword}
              aria-pressed={showPw}
              className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-text-muted hover:text-primary-container"
            >
              {showPw ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
            </button>
          </div>
        </Field>

        <Button3D type="submit" size="lg" fullWidth loading={isSubmitting} icon={<LogIn className="size-5" aria-hidden />}>
          {fa.auth.login}
        </Button3D>

        <p className="text-center text-body-sm text-text-secondary">
          {fa.auth.noAccount}{' '}
          <Link href="/register" className="font-semibold text-primary-container underline-offset-4 hover:underline">
            {fa.auth.registerLink}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
