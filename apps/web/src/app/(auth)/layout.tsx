import type { ReactNode } from 'react';

/** Calm, centered layout for login/registration. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="flex min-h-dvh items-start justify-center bg-gradient-to-b from-surface-container to-background-base px-margin-mobile py-space-xl sm:items-center"
    >
      {children}
    </main>
  );
}
