import { LoginForm } from '@/components/auth/LoginForm';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.auth.loginTitle };

export default function LoginPage() {
  return <LoginForm />;
}
