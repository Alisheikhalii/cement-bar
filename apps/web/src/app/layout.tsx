import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import '@cb/ui/styles.css';
import { Providers } from '@/components/Providers';
import { fa } from '@/i18n/fa';

export const metadata: Metadata = {
  title: { default: fa.brand.title, template: `%s — ${fa.brand.name}` },
  description: fa.brand.description,
  applicationName: fa.brand.subtitle,
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[70] focus:rounded-xl focus:bg-surface-card focus:p-space-sm focus:shadow-elevation-3"
        >
          {fa.common.skipToContent}
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
