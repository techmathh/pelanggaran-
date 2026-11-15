import { useRef, useState, type ReactNode } from 'react';
import { calculateTiltTransform } from '../shared/motionMath';

interface Tilt3DCardProps {
  children: ReactNode;
  className?: string;
  maxTiltDeg?: number;
  scaleOnHover?: number;
  glare?: boolean;
}

export function Tilt3DCard({
  children,
  className = '',
  maxTiltDeg = 6,
  scaleOnHover = 1.012,
  glare = true,
}: Tilt3DCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({
    active: false,
    rotateX: 0,
    rotateY: 0,
    glareX: 50,
    glareY: 50,
  });

  function supportsHoverTilt(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    return !reduced && finePointer;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!supportsHoverTilt()) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const normY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    const angles = calculateTiltTransform(normX, normY, maxTiltDeg);

    setTilt({
      active: true,
      ...angles,
    });
  }

  function handlePointerLeave() {
    if (!tilt.active) return;
    setTilt({
      active: false,
      rotateX: 0,
      rotateY: 0,
      glareX: 50,
      glareY: 50,
    });
  }

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{
        transform: tilt.active
          ? `perspective(960px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale3d(${scaleOnHover}, ${scaleOnHover}, 1)`
          : 'perspective(960px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
        transition: tilt.active
          ? 'transform 90ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease'
          : 'transform 340ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 260ms ease',
        transformStyle: 'preserve-3d',
        willChange: 'transform',
      }}
      className={`relative ${className}`}
    >
      {children}
      {glare && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-200"
          style={{
            opacity: tilt.active ? 1 : 0,
            background: `radial-gradient(circle 240px at ${tilt.glareX}% ${tilt.glareY}%, rgba(255, 255, 255, 0.26), rgba(59, 130, 246, 0.05) 45%, transparent 75%)`,
          }}
        />
      )}
    </div>
  );
}
