'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Unknown pages go back to the dashboard. */
export default function NotFound() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return null;
}
