import type { CSSProperties } from "react";
import { COLORS, noteName } from "../config";
import type { PadItem } from "../types";

interface Props {
  b: PadItem;
  lit: boolean;
  edit: boolean;
  selected: boolean;
  onSelect: () => void;
  onPress: () => void;
  onRelease: () => void;
}

export function PadButton({ b, lit, edit, selected, onSelect, onPress, onRelease }: Props) {
  const meta = b.type === "note" ? `${noteName(b.num)}  ·  ${b.num}` : b.type === "cc" ? `CC ${b.num}` : `PC ${b.num}`;
  const binds = [b.key && (b.key === "space" ? "Space" : b.key.toUpperCase()), b.gamepad].filter(Boolean).join(" / ");
  return (
    <button className={"pad" + (lit ? " lit" : "") + (selected ? " sel" : "")} style={{ "--c": COLORS[b.color] || COLORS.pad } as CSSProperties}
      onPointerDown={e => { if (edit) { onSelect(); return; } e.currentTarget.setPointerCapture(e.pointerId); onPress(); }}
      onPointerUp={() => !edit && onRelease()} onPointerCancel={() => !edit && onRelease()}
      onContextMenu={e => e.preventDefault()}>
      <span className="lbl">{b.label}</span>
      <span className="meta"><b>{meta}</b>{b.mode !== "momentary" && b.type !== "pc" ? "  ·  " + b.mode : ""}{binds && <><br />{binds}</>}</span>
    </button>
  );
}
