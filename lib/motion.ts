'use client';

/**
 * Shared motion presets (UI streamlining Wave 1). One vocabulary for the
 * whole app: critically damped springs by default (no bounce unless the
 * gesture carried momentum), 150–300ms micro-interactions, and reduced-motion
 * fallbacks that cross-fade instead of translating.
 */

import { useReducedMotion } from 'motion/react';
import type { Transition, Variants } from 'motion/react';

/** Default UI spring — critically damped, ~0.35s settle. */
export const springDefault: Transition = { type: 'spring', bounce: 0, duration: 0.35 };

/** Snappy spring for micro-interactions (indicators, chips). */
export const springSnappy: Transition = { type: 'spring', bounce: 0, duration: 0.2 };

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: springDefault },
  exit: { opacity: 0, y: 12, transition: { duration: 0.15 } },
};

/** Dialog/popover entrance — scale from the chrome it came from. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: springDefault },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.15 } },
};

/**
 * Motion-safe variants: returns the given variants normally, or a plain
 * cross-fade when the user prefers reduced motion (feedback stays, movement
 * goes). Usage: `const v = useMotionSafe(fadeInUp)`.
 */
export function useMotionSafe(variants: Variants): Variants {
  const reduced = useReducedMotion();
  return reduced ? fade : variants;
}
