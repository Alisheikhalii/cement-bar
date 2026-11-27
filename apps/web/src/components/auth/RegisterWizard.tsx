'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, CheckCircle2, UserPlus } from 'lucide-react';
import { enDigits, faDigits } from '@cb/shared';
import { Alert, Button3D, button3DClasses, cn } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import { AuthCard } from './AuthCard';
import { registerFormSchema, type RegisterForm } from './register-data';
import { AccountStep, CarrierStep, ProfileStep, VehicleStep } from './RegisterSteps';

const r = fa.register;

const STEP_FIELDS: FieldPath<RegisterForm>[][] = [
  ['mobile', 'password', 'confirmPassword'],
  ['firstName', 'lastName', 'nationalId', 'licenseNo', 'licenseIssueDate', 'birthCityId', 'healthCardExpiry'],
  ['vehicle.smartCardNo', 'vehicle.plate', 'vehicle.loaderTypeId', 'vehicle.smartCardExpiry', 'vehicle.inspectionExpiry'],
  ['carrierId'],
];
const LAST = STEP_FIELDS.length - 1;

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-space-lg grid grid-cols-4 gap-1" aria-label={r.stepOf(faDigits(step + 1), faDigits(LAST + 1))}>
      {r.steps.map((label, i) => (
        <li key={label} aria-current={i === step ? 'step' : undefined} className="flex flex-col items-center gap-1 text-center">
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full text-label-lg transition-colors',
              i < step && 'bg-success text-on-primary',
              i === step && 'bg-primary-container text-on-primary shadow-bevel-primary',
              i > step && 'bg-surface-container text-text-muted',
            )}
          >
            {i < step ? <CheckCircle2 className="size-5" aria-hidden /> : faDigits(i + 1)}
          </span>
          <span className={cn('text-label-sm', i === step ? 'text-primary-container' : 'text-text-muted')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function RegisterWizard() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RegisterForm>({
    // raw: submit the un-transformed input (API expects plate as {two,letter,three,iran}).
    resolver: zodResolver(registerFormSchema, { error: faErrorMap }, { raw: true }),
    mode: 'onTouched',
    defaultValues: {
      mobile: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
      nationalId: '',
      licenseNo: '',
      licenseIssueDate: '',
      healthCardExpiry: '',
      carrierId: '',
      vehicle: {
        smartCardNo: '',
        plate: { two: '', letter: '' as RegisterForm['vehicle']['plate']['letter'], three: '', iran: '' },
        loaderTypeId: '',
        smartCardExpiry: '',
        inspectionExpiry: '',
      },
    },
  });

  const next = async () => {
    const fields = STEP_FIELDS[step];
    if (fields && (await form.trigger(fields, { shouldFocus: true }))) setStep((s) => Math.min(s + 1, LAST));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const { confirmPassword: _confirm, ...body } = values;
    try {
      await api.post('/auth/register-driver', { ...body, mobile: enDigits(body.mobile) });
      setDone(true);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  if (done) {
    return (
      <AuthCard title={r.title}>
        <div className="flex flex-col items-center gap-space-md text-center">
          <CheckCircle2 className="size-14 text-success" aria-hidden />
          <p role="status" className="text-headline-sm text-text-primary">
            {r.success}
          </p>
          <Link href="/login" className={button3DClasses({ variant: 'primary', fullWidth: true })}>
            {r.goLogin}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={r.title} subtitle={r.subtitle} wide>
      <Stepper step={step} />
      <form
        noValidate
        onSubmit={(e) => {
          if (step < LAST) {
            e.preventDefault();
            void next();
          } else void onSubmit(e);
        }}
        className="flex flex-col gap-space-lg"
      >
        {step === 0 ? <AccountStep form={form} /> : null}
        {step === 1 ? <ProfileStep form={form} /> : null}
        {step === 2 ? <VehicleStep form={form} /> : null}
        {step === 3 ? <CarrierStep form={form} /> : null}

        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

        <div className="flex flex-col-reverse gap-space-sm sm:flex-row sm:justify-between">
          {step > 0 ? (
            <Button3D variant="neutral" onClick={() => setStep((s) => s - 1)} icon={<ArrowRight className="size-4" aria-hidden />}>
              {fa.common.previous}
            </Button3D>
          ) : (
            <span />
          )}
          {step < LAST ? (
            <Button3D type="submit" className="flex-row-reverse" icon={<ArrowLeft className="size-4" aria-hidden />}>
              {fa.common.next}
            </Button3D>
          ) : (
            <Button3D type="submit" variant="success" loading={form.formState.isSubmitting} icon={<UserPlus className="size-4" aria-hidden />}>
              {r.submit}
            </Button3D>
          )}
        </div>

        <p className="text-center text-body-sm text-text-secondary">
          {r.hasAccount}{' '}
          <Link href="/login" className="font-semibold text-primary-container underline-offset-4 hover:underline">
            {r.loginLink}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
