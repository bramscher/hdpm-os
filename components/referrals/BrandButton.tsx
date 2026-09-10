import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Referrer-portal button — mirrors hdpm-web's Button (green accent, spring
 * hover-lift, optional trailing arrow) so the partner-facing pages match
 * highdesertpm.com. Staff/admin uses components/ui/button (Desert style).
 */
type Variant = 'primary' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'group inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] active:duration-75 motion-reduce:transform-none disabled:pointer-events-none disabled:opacity-60';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-green text-white shadow-sm hover:bg-brand-greenDark hover:shadow-md',
  outline: 'border border-neutral-200 bg-white text-brand-ink hover:border-brand-green hover:text-brand-greenDark',
  ghost: 'text-neutral-600 hover:text-brand-ink',
};

const sizes: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-8 py-4 text-base',
};

function Arrow() {
  return (
    <svg aria-hidden className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

type Common = { variant?: Variant; size?: Size; withArrow?: boolean; className?: string; children: ReactNode };
type AsLink = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & { href: string };
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };

export default function BrandButton({ variant = 'primary', size = 'md', withArrow, className, children, ...rest }: AsLink | AsButton) {
  const classes = cn(base, variants[variant], sizes[size], className);
  const content = (
    <>
      {children}
      {withArrow && <Arrow />}
    </>
  );
  if ('href' in rest && typeof rest.href === 'string') {
    const { href, ...a } = rest as AsLink;
    return (
      <Link href={href} className={classes} {...a}>
        {content}
      </Link>
    );
  }
  return (
    <button className={classes} {...(rest as AsButton)}>
      {content}
    </button>
  );
}
