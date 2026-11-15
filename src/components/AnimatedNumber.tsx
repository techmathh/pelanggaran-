import { useEffect, useRef, useState } from 'react';
import { easeOutCubic } from '../shared/motionMath';

interface AnimatedNumberProps {
  value: number;
  durationMs?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

export function AnimatedNumber({
  value,
  durationMs = 420,
  className = '',
  prefix = '',
  suffix = '',
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const currentRef = useRef<number>(value);

  useEffect(() => {
    const startVal = currentRef.current;
    const endVal = value;
    if (startVal === endVal) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || durationMs <= 0) {
      currentRef.current = endVal;
      setDisplayValue(endVal);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(progress);
      const interpolated = Math.round(startVal + (endVal - startVal) * eased);
      currentRef.current = interpolated;
      setDisplayValue(interpolated);

      if (progress < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        currentRef.current = endVal;
        setDisplayValue(endVal);
      }
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [value, durationMs]);

  return (
    <span className={`font-mono-num ${className}`}>
      {prefix}
      {displayValue}
      {suffix}
    </span>
  );
}
