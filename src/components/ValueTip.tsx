import { useState, type PointerEvent, type ReactNode } from "react";

export interface TipPos { x: number; y: number }

// Floating value readout shown above a knob/fader while it's being dragged.
// Uses fixed positioning so the strip's horizontal scroll doesn't clip it.
export function useValueTip() {
  const [tip, setTip] = useState<TipPos | null>(null);
  const show = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top });
  };
  const hide = () => setTip(null);
  return { tip, show, hide };
}

export function ValueTip({ tip, color, children }: { tip: TipPos | null; color: string; children: ReactNode }) {
  if (!tip) return null;
  return <span className="vtip" style={{ left: tip.x, top: tip.y, borderColor: color }}>{children}</span>;
}
