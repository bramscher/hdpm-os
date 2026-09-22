import Link from 'next/link';

/** Shared title-level entry point to a page's staff guide. */
export function HowThisWorksLink({ href, section }: { href: string; section: string }) {
  return (
    <Link
      href={href}
      aria-label={`How ${section} works`}
      className="inline-flex min-h-9 items-center rounded text-sm font-medium text-green-800 underline underline-offset-4 hover:text-green-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-700"
    >
      How this works
    </Link>
  );
}
