'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * Shared scroll-reveal wrapper for the homepage story prototype.
 * Centralises prefers-reduced-motion handling in one place: when the
 * visitor has reduced motion set, content renders in its final state
 * immediately with no animation, instead of skipping the animation
 * timing but still moving/fading things around.
 */
export default function Reveal({
  children,
  delay = 0,
  y = 24,
  className = '',
  as = 'div',
  once = true,
}) {
  const reduce = useReducedMotion();
  const Tag = as;

  if (reduce) {
    return <Tag className={className}>{children}</Tag>;
  }

  const MotionTag = motion[as] || motion.div;

  return (
    <MotionTag
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-80px' }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </MotionTag>
  );
}
