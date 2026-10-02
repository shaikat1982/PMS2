'use client';

// Small adapter over next/navigation with the router API the UI components use
// (Link, NavLink, useNavigate, useParams, useSearchParams, useLocation).

import NextLink from 'next/link';
import { useParams as useNextParams, usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation';
import { createElement } from 'react';

export function Link({ to, ...rest }) {
  return createElement(NextLink, { href: to, ...rest });
}

/** A link whose className can be a function of { isActive }. `end` matches the path exactly. */
export function NavLink({ to, end = false, className, ...rest }) {
  const pathname = usePathname();
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  const cls = typeof className === 'function' ? className({ isActive }) : className;
  return createElement(NextLink, { href: to, className: cls, 'aria-current': isActive ? 'page' : undefined, ...rest });
}

export function useNavigate() {
  const router = useRouter();
  return (to, { replace = false } = {}) => (replace ? router.replace(to) : router.push(to));
}

export const useParams = useNextParams;

export function useLocation() {
  return { pathname: usePathname() };
}

/**
 * [searchParams, setSearchParams]. Changing only the query string uses the History API,
 * which Next.js picks up without a server round-trip, so tabs switch instantly and the
 * back button still works.
 */
export function useSearchParams() {
  const params = useNextSearchParams();
  const set = (next) => {
    const qs = new URLSearchParams(next).toString();
    window.history.pushState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  };
  return [params, set];
}
