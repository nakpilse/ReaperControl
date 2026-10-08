import type { CSSProperties, ReactNode } from "react";
import { COLORS } from "../config";
import type { PadItem } from "../types";

interface Props {
  g: PadItem;
  /** Cells it spans in the parent grid (already clamped to the parent's columns) */
  span: { c: number; r: number };
  count: number;
  edit: boolean;
  selected: boolean;
  full: boolean;
  onSelect: () => void;
  onAdd: () => void;
  children: ReactNode;
}

// A framed block spanning several cells of a section's grid, laying its own
// buttons out on a smaller grid — fits more, smaller pads in the same space.
export function PadGroup({ g, span, count, edit, selected, full, onSelect, onAdd, children }: Props) {
  const gg = g.group!;
  const cols = Math.max(1, gg.cols);
  const rows = gg.rows || Math.max(1, Math.ceil(count / cols));
  return (
    <div className={"group" + (selected ? " sel" : "")}
      style={{ "--c": COLORS[g.color] || COLORS.pad, gridColumn: `span ${span.c}`, gridRow: `span ${span.r}` } as CSSProperties}>
      {(edit || g.label) && (
        <div className="ghead" onPointerDown={() => edit && onSelect()}>
          <span className="gname">{g.label || "Group"}</span>
          {edit && <button className="tb mini" disabled={full} title={full ? `Group is full (${cols} × ${rows})` : "Add button to this group"}
            onPointerDown={e => e.stopPropagation()} onClick={onAdd}>+</button>}
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {children}
      </div>
    </div>
  );
}
