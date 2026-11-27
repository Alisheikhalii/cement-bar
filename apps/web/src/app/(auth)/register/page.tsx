import { RegisterWizard } from '@/components/auth/RegisterWizard';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.register.title };

export default function RegisterPage() {
  return <RegisterWizard />;
}
