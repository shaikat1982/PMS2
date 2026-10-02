import { Suspense } from 'react';
import AppShell from '@/ui/AppShell.jsx';
import '@/ui/styles.css';
import '@/ui/software.css';

export const metadata = {
  title: { default: 'Instacall PM', template: '%s · Instacall PM' },
  description: 'Project management for software development, SEO, digital marketing and operations teams',
};

export const viewport = { width: 'device-width', initialScale: 1 };

const Booting = () => <div className="boot"><div className="spinner" aria-label="Loading" /></div>;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* The shell reads the URL (?task=ID), which needs a Suspense boundary in Next.js. */}
        <Suspense fallback={<Booting />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
