import { notFound } from 'next/navigation';
import { Gallery } from '@/components/dev/Gallery';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.dev.title };

/** Dev-only component gallery; 404 in production builds. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Gallery />;
}
