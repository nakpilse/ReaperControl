import { useRef, type PointerEvent } from "react";
import { clamp, COLORS } from "../config";
import type { Fader } from "../types";
import { useValueTip, ValueTip } from "./ValueTip";

// arc helpers for knobs (0° = top, clockwise)
const polar = (a: number, r: number): [number, number] => { const rad = (a - 90) * Math.PI / 180; return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)]; };
const arc = (a0: number, a1: number, r: number) => {
  if (a1 < a0) [a0, a1] = [a1, a0];
  if (a1 - a0 < 0.5) a1 = a0 + 0.5;
  const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

interface Props {
  f: Fader;
  max: number;
  edit: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (v: number) => void;
}

export function Knob({ f, max, edit, selected, onSelect, onChange }: Props) {
  const drag = useRef<{ x: number; y: number; v: number } | null>(null);
  const { tip, show, hide } = useValueTip();
  const c = COLORS[f.color] || COLORS.sand;
  const t = f.value / max;
  const ang = -135 + t * 270;
  const from = f.type === "pb" || f.cc === 10 ? 0 : -135;   // bipolar knobs fill from the centre
  const [px, py] = polar(ang, 27);
  const shown = f.type === "pb" ? f.value - 8192 : f.value;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (edit) { onSelect(); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, v: f.value };
    show(e);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const delta = (d.y - e.clientY) + (e.clientX - d.x) * 0.6;   // up or right raises the value
    onChange(Math.round(clamp(d.v + (delta / 200) * max, 0, max)));
  };
  const up = () => { drag.current = null; hide(); if (f.type === "pb") onChange(8192); };

  return (
    <div className={"knob" + (selected ? " sel" : "")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="kname">{f.label}</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <path d={arc(-135, 135, 40)} stroke="#33383E" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d={arc(from, ang, 40)} stroke={c} strokeWidth="7" fill="none" strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${c}88)` }} />
        <circle cx="50" cy="50" r="31" fill="#2B2F34" stroke="#3A3F45" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="24" fill="#24282C" />
        <line x1="50" y1="50" x2={px} y2={py} stroke="#E6E9EC" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className="kval">{shown}</span>
      <ValueTip tip={tip} color={c}>{shown}</ValueTip>
      <span className="ksub">{f.type === "pb" ? "Pitch bend" : "CC " + f.cc}{f.axis ? "  ·  " + f.axis : ""}</span>
    </div>
  );
}
