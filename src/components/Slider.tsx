import { useRef, type CSSProperties, type PointerEvent } from "react";
import { clamp, COLORS } from "../config";
import type { Fader } from "../types";
import { useValueTip, ValueTip } from "./ValueTip";

interface Props {
  f: Fader;
  max: number;
  edit: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (v: number) => void;
}

// Vertical fader — same data and MIDI as a Knob, drawn as a slider strip.
export function Slider({ f, max, edit, selected, onSelect, onChange }: Props) {
  const drag = useRef<{ y: number; v: number; h: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const { tip, show, hide } = useValueTip();
  const c = COLORS[f.color] || COLORS.sand;
  const t = f.value / max;
  const bipolar = f.type === "pb" || f.cc === 10;   // bipolar faders fill from the centre
  const lo = bipolar ? Math.min(t, 0.5) : 0, hi = bipolar ? Math.max(t, 0.5) : t;
  const shown = f.type === "pb" ? f.value - 8192 : f.value;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (edit) { onSelect(); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: f.value, h: trackRef.current?.clientHeight || 100 };
    show(e);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    onChange(Math.round(clamp(d.v + ((d.y - e.clientY) / d.h) * max, 0, max)));   // drag up raises the value
  };
  const up = () => { drag.current = null; hide(); if (f.type === "pb") onChange(8192); };

  return (
    <div className={"knob slider" + (selected ? " sel" : "")} style={{ "--c": c } as CSSProperties}
         onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="kname">{f.label}</span>
      <div className="track" ref={trackRef}>
        <div className="fill" style={{ bottom: `${lo * 100}%`, height: `${(hi - lo) * 100}%` }}></div>
        <div className="thumb" style={{ bottom: `${t * 100}%` }}></div>
      </div>
      <span className="kval">{shown}</span>
      <ValueTip tip={tip} color={c}>{shown}</ValueTip>
      <span className="ksub">{f.type === "pb" ? "Pitch bend" : "CC " + f.cc}{f.axis ? "  ·  " + f.axis : ""}</span>
    </div>
  );
}
