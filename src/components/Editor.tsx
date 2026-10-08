import type { ReactNode } from "react";
import { clamp, COLORS, findBtn, GP_AXES, GP_BUTTONS, groupCapacity, groupItems, noteName, uid } from "../config";
import type { ButtonMode, ButtonType, Config, Fader, FaderGroup, FaderStyle, FaderType, GroupGrid, PadItem, Page, Section, Selection, UpdateConfig } from "../types";

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field">{label}{children}</label>; }
const num = (v: string, lo: number, hi: number) => clamp(parseInt(v, 10) || 0, lo, hi);

function ChannelSelect({ value, onChange, title }: { value: number; onChange: (v: number) => void; title?: string }) {
  return (
    <select value={value} onChange={e => onChange(+e.target.value)} title={title || "Channel"}>
      <option value={0}>Global (top bar)</option>
      {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
    </select>
  );
}
function OutputSelect({ value, outputs, onChange, title }: { value: string; outputs: MIDIOutput[]; onChange: (v: string) => void; title?: string }) {
  const known = outputs.some(o => o.name === value);
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value)} title={title || "MIDI output"}>
      <option value="">Global (top bar)</option>
      {!known && value && <option value={value}>{value} (offline)</option>}
      {outputs.map(o => <option key={o.id} value={o.name ?? ""}>{o.name}</option>)}
    </select>
  );
}
function ModeSelect({ b, set }: { b: PadItem; set: (k: "mode", v: ButtonMode) => void }) {
  return (
    <select value={b.mode} onChange={e => set("mode", e.target.value as ButtonMode)}>
      <option value="momentary">Momentary</option><option value="toggle">Toggle</option><option value="trigger">Trigger</option>
    </select>
  );
}
function Swatches({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="swatches">{Object.entries(COLORS).map(([k, c]) =>
      <span key={k} className={"swatch" + (value === k ? " on" : "")} style={{ background: c }} onClick={() => onChange(k)} title={k}></span>)}</div>
  );
}

interface Props {
  sel: Selection;
  config: Config;
  update: UpdateConfig;
  close: () => void;
  setSel: (s: Selection | null) => void;
  outputs: MIDIOutput[];
  addToGroup: (secId: string, groupId: string) => void;
  addPage: (secId: string) => void;
  addHelixTab: (secId: string) => void;
  renamePage: (secId: string, pageId: string, title: string) => void;
  setPageField: <K extends "outputName" | "channel" | "cols" | "rows">(secId: string, pageId: string, key: K, val: Page[K]) => void;
  deletePage: (secId: string, pageId: string) => void;
}

export function Editor({ sel, config, update, close, setSel, outputs, addToGroup, addPage, addHelixTab, renamePage, setPageField, deletePage }: Props) {
  if (sel.kind === "button") {
    const loc = findBtn(config, sel.id); if (!loc) return null;
    const b = loc.s.items[loc.i];
    const set = <K extends keyof PadItem>(k: K, v: PadItem[K]) => update(d => { const l = findBtn(d, sel.id)!; l.s.items[l.i][k] = v; });
    // Swaps with the nearest neighbour in the same tab and group, so the move is visible
    const sameSpot = (x: PadItem, y: PadItem) => (x.pageId || "") === (y.pageId || "") && (x.groupId || "") === (y.groupId || "");
    const move = (dir: number) => update(d => { const l = findBtn(d, sel.id)!; const it = l.s.items; let j = l.i + dir;
      while (j >= 0 && j < it.length && !sameSpot(it[j], it[l.i])) j += dir;
      if (j < 0 || j >= it.length) return;
      [it[l.i], it[j]] = [it[j], it[l.i]]; });
    const dup = () => { const id = uid(); update(d => { const l = findBtn(d, sel.id)!; const src = l.s.items[l.i];
      l.s.items.splice(l.i + 1, 0, { ...structuredClone(src), id, key: "", gamepad: "" });
      if (src.group) l.s.items.push(...groupItems(l.s, src.id).map(k => ({ ...structuredClone(k), id: uid(), groupId: id, key: "", gamepad: "" }))); });
      setSel({ kind: "button", id }); };
    const del = () => { update(d => { const l = findBtn(d, sel.id)!; l.s.items = l.s.items.filter(x => x.id !== sel.id && x.groupId !== sel.id); }); close(); };
    // A group moves with its buttons; a button moved out of its section leaves its group
    const toSection = (secId: string) => update(d => { const l = findBtn(d, sel.id)!; const target = d.sections.find(s => s.id === secId)!;
      const moving = l.s.items.filter(x => x.id === sel.id || x.groupId === sel.id);
      l.s.items = l.s.items.filter(x => !moving.includes(x));
      moving.forEach(x => { x.pageId = target.activePage; if (x.id === sel.id) delete x.groupId; });
      target.items.push(...moving); });
    const sectionField = (
      <Field label="Section">
        <select value={loc.s.id} onChange={e => toSection(e.target.value)}>
          {config.sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </Field>
    );

    if (b.group) {
      const g = b.group; const kids = groupItems(loc.s, b.id); const cap = groupCapacity(b);
      const setG = <K extends keyof GroupGrid>(k: K, v: GroupGrid[K]) => update(d => { const l = findBtn(d, sel.id)!; l.s.items[l.i].group![k] = v; });
      return (
        <div className="drawer">
          <h3>Group <button className="tb" onClick={close}>Close</button></h3>
          <Field label="Label (blank = no header when playing)"><input type="text" value={b.label} onChange={e => set("label", e.target.value)} /></Field>
          <Field label="Colour"><Swatches value={b.color} onChange={v => set("color", v)} /></Field>
          <div className="two">
            <Field label="Width (cells)"><input type="number" min="1" max="16" value={g.colSpan} onChange={e => setG("colSpan", num(e.target.value, 1, 16))} /></Field>
            <Field label="Height (cells)"><input type="number" min="1" max="16" value={g.rowSpan} onChange={e => setG("rowSpan", num(e.target.value, 1, 16))} /></Field>
          </div>
          <div className="two">
            <Field label="Inner columns"><input type="number" min="1" max="16" value={g.cols} onChange={e => setG("cols", num(e.target.value, 1, 16))} /></Field>
            <Field label="Inner rows (0 = auto)"><input type="number" min="0" max="16" value={g.rows} onChange={e => setG("rows", num(e.target.value, 0, 16))} /></Field>
          </div>
          {sectionField}
          <div className="actions">
            <button className="tb primary" disabled={kids.length >= cap} onClick={() => addToGroup(loc.s.id, b.id)}>
              Add button{cap !== Infinity ? ` (${kids.length}/${cap})` : ""}
            </button>
            <button className="tb" onClick={() => move(-1)}>Move left</button>
            <button className="tb" onClick={() => move(1)}>Move right</button>
            <button className="tb" onClick={dup}>Duplicate</button>
            <button className="tb danger" onClick={() => { if (!kids.length || confirm(`Delete group “${b.label || "Group"}” and its ${kids.length} buttons?`)) del(); }}>Delete</button>
          </div>
          <p className="help">A group takes Width × Height cells of the tab's grid and lays its own buttons out on a smaller Inner columns × Inner rows grid — fit more, smaller pads into the same space. Width is capped at the tab's column count.</p>
          <p className="help">Buttons in a group use the tab's MIDI output and channel like any other button. Move a button into or out of a group from its own editor.</p>
        </div>
      );
    }

    const groups = loc.s.items.filter(x => x.group && (x.pageId || "") === (b.pageId || ""));
    const toGroup = (gid: string) => update(d => { const l = findBtn(d, sel.id)!; const it = l.s.items[l.i];
      if (gid) it.groupId = gid; else delete it.groupId;
      l.s.items.splice(l.i, 1); l.s.items.push(it); });
    return (
      <div className="drawer">
        <h3>Block <button className="tb" onClick={close}>Close</button></h3>
        <Field label="Label"><input type="text" value={b.label} onChange={e => set("label", e.target.value)} /></Field>
        <div className="two">
          <Field label="Message">
            <select value={b.type} onChange={e => set("type", e.target.value as ButtonType)}>
              <option value="note">Note</option><option value="cc">Control change</option><option value="pc">Program change</option>
            </select>
          </Field>
          <Field label={b.type === "note" ? `Note (${noteName(b.num)})` : b.type === "cc" ? "CC number" : "Program"}>
            <input type="number" min="0" max="127" value={b.num} onChange={e => set("num", num(e.target.value, 0, 127))} />
          </Field>
        </div>
        {b.type !== "pc" && <div className="two">
          <Field label={b.type === "note" ? "Velocity (blank = default)" : "On value"}>
            <input type="number" min="0" max="127" value={b.value} placeholder={b.type === "note" ? "default" : "127"}
              onChange={e => set("value", e.target.value === "" ? "" : num(e.target.value, 0, 127))} />
          </Field>
          {b.type === "cc"
            ? <Field label="Off value"><input type="number" min="0" max="127" value={b.off} onChange={e => set("off", num(e.target.value, 0, 127))} /></Field>
            : <Field label="Mode"><ModeSelect b={b} set={set} /></Field>}
        </div>}
        {b.type === "cc" && <Field label="Mode"><ModeSelect b={b} set={set} /></Field>}
        <Field label="Channel"><ChannelSelect value={b.channel} onChange={v => set("channel", v)} /></Field>
        <Field label="Colour"><Swatches value={b.color} onChange={v => set("color", v)} /></Field>
        <div className="two">
          <Field label="Keyboard key">
            <input type="text" readOnly placeholder="Tap, then press a key"
              value={b.key ? (b.key === "space" ? "Space" : b.key.toUpperCase()) : ""}
              onKeyDown={e => { if (e.key === "Tab" || e.key === "Escape") return; e.preventDefault();
                set("key", (e.key === "Backspace" || e.key === "Delete") ? "" : e.key === " " ? "space" : e.key.toLowerCase()); }} />
          </Field>
          <Field label="Gamepad button">
            <select value={b.gamepad} onChange={e => set("gamepad", e.target.value)}>
              <option value="">None</option>{GP_BUTTONS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
        </div>
        <div className="two">
          {sectionField}
          <Field label="Group">
            <select value={b.groupId || ""} onChange={e => toGroup(e.target.value)} disabled={!groups.length && !b.groupId}>
              <option value="">None</option>
              {groups.map(g => {
                const isFull = g.id !== b.groupId && groupItems(loc.s, g.id).length >= groupCapacity(g);
                return <option key={g.id} value={g.id} disabled={isFull}>{(g.label || "Group") + (isFull ? " (full)" : "")}</option>;
              })}
            </select>
          </Field>
        </div>
        <div className="actions">
          <button className="tb" onClick={() => move(-1)}>Move left</button>
          <button className="tb" onClick={() => move(1)}>Move right</button>
          <button className="tb" onClick={dup}>Duplicate</button>
          <button className="tb danger" onClick={del}>Delete</button>
        </div>
        <p className="help">Backspace in the key box clears it. Momentary sends off on release, toggle latches, trigger sends a short press.</p>
      </div>
    );
  }

  if (sel.kind === "fader") {
    const i = config.faders.findIndex(f => f.id === sel.id); if (i < 0) return null;
    const f = config.faders[i];
    const set = <K extends keyof Fader>(k: K, v: Fader[K]) => update(d => { const x = d.faders.find(x => x.id === sel.id)!; x[k] = v;
      if (k === "type") x.value = v === "pb" ? 8192 : 64; });
    const move = (dir: number) => update(d => { const j = i + dir; if (j < 0 || j >= d.faders.length) return; [d.faders[i], d.faders[j]] = [d.faders[j], d.faders[i]]; });
    return (
      <div className="drawer">
        <h3>{f.style === "fader" ? "Fader" : "Knob"} <button className="tb" onClick={close}>Close</button></h3>
        <div className="two">
          <Field label="Label"><input type="text" value={f.label} onChange={e => set("label", e.target.value)} /></Field>
          <Field label="Style">
            <select value={f.style || "knob"} onChange={e => set("style", e.target.value as FaderStyle)}>
              <option value="knob">Knob</option><option value="fader">Fader</option>
            </select>
          </Field>
        </div>
        <div className="two">
          <Field label="Sends">
            <select value={f.type} onChange={e => set("type", e.target.value as FaderType)}>
              <option value="cc">Control change</option><option value="pb">Pitch bend</option>
            </select>
          </Field>
          {f.type === "cc" && <Field label="CC number"><input type="number" min="0" max="127" value={f.cc} onChange={e => set("cc", num(e.target.value, 0, 127))} /></Field>}
        </div>
        <Field label="Channel"><ChannelSelect value={f.channel} onChange={v => set("channel", v)} /></Field>
        <Field label="Colour"><Swatches value={f.color || "sand"} onChange={v => set("color", v)} /></Field>
        <div className="two">
          <Field label="Gamepad axis">
            <select value={f.axis} onChange={e => set("axis", e.target.value)}>
              <option value="">None</option>{GP_AXES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Invert axis">
            <select value={f.invert ? "1" : ""} onChange={e => set("invert", !!e.target.value)}>
              <option value="">No</option><option value="1">Yes</option>
            </select>
          </Field>
        </div>
        <div className="actions">
          <button className="tb" onClick={() => move(-1)}>Move left</button>
          <button className="tb" onClick={() => move(1)}>Move right</button>
          <button className="tb danger" onClick={() => { update(d => { d.faders.splice(i, 1); }); close(); }}>Delete</button>
        </div>
        <p className="help">Drag a knob up or right to raise it; drag a fader up. Sticks spring back to centre, so they suit pan and pitch bend; triggers (LT/RT) suit mod or expression.</p>
      </div>
    );
  }

  if (sel.kind === "section") {
    const i = config.sections.findIndex(s => s.id === sel.id); if (i < 0) return null;
    const s = config.sections[i];
    const set = <K extends keyof Section>(k: K, v: Section[K]) => update(d => { d.sections[i][k] = v; });
    const move = (dir: number) => update(d => { const j = i + dir; if (j < 0 || j >= d.sections.length) return; [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]]; });
    return (
      <div className="drawer">
        <h3>Section <button className="tb" onClick={close}>Close</button></h3>
        <Field label="Title"><input type="text" value={s.title} onChange={e => set("title", e.target.value)} /></Field>
        <div className="two">
          <Field label="Columns"><input type="number" min="1" max="16" value={s.cols} onChange={e => set("cols", num(e.target.value, 1, 16))} /></Field>
          <Field label="Rows (0 = auto)"><input type="number" min="0" max="16" value={s.rows || 0} onChange={e => set("rows", num(e.target.value, 0, 16))} /></Field>
        </div>
        <div className="two">
          <Field label="MIDI output"><OutputSelect value={s.outputName} outputs={outputs} onChange={v => set("outputName", v)} /></Field>
          <Field label="Channel"><ChannelSelect value={s.channel || 0} onChange={v => set("channel", v)} /></Field>
        </div>
        <Field label="Pad tabs">
          {(s.pages || []).map(p => {
            const count = s.items.filter(b => (b.pageId || s.pages![0].id) === p.id).length;
            return (
              <div className="pagecard" key={p.id}>
                <div className="two">
                  <input type="text" value={p.title} onChange={e => renamePage(s.id, p.id, e.target.value)} />
                  <button className="tb danger" disabled={s.pages!.length <= 1}
                    onClick={() => { if (!count || confirm(`Delete tab "${p.title}" and its ${count} buttons?`)) deletePage(s.id, p.id); }}>Delete</button>
                </div>
                <div className="two">
                  <OutputSelect value={p.outputName} outputs={outputs} onChange={v => setPageField(s.id, p.id, "outputName", v)} />
                  <ChannelSelect value={p.channel || 0} onChange={v => setPageField(s.id, p.id, "channel", v)} />
                </div>
                <div className="two">
                  <input type="number" min="0" max="16" value={p.cols || 0} title="Columns (0 = section's)" onChange={e => setPageField(s.id, p.id, "cols", num(e.target.value, 0, 16))} />
                  <input type="number" min="0" max="16" value={p.rows || 0} title="Rows (0 = section's)" onChange={e => setPageField(s.id, p.id, "rows", num(e.target.value, 0, 16))} />
                </div>
              </div>
            );
          })}
          <div className="two">
            <button className="tb" onClick={() => addPage(s.id)}>Add tab</button>
            <button className="tb" onClick={() => addHelixTab(s.id)}>Add Helix Native tab</button>
          </div>
        </Field>
        <div className="actions">
          <button className="tb" onClick={() => move(-1)}>Move up</button>
          <button className="tb" onClick={() => move(1)}>Move down</button>
          <button className="tb danger" onClick={() => { if (!s.items.length || confirm(`Delete “${s.title}” and its ${s.items.length} buttons?`)) { update(d => { d.sections.splice(i, 1); }); close(); } }}>Delete section</button>
        </div>
        <p className="help">Sections share the screen height by how many rows they have, so the deck always fills the display. With a fixed row count, a tab holds at most Columns × Rows buttons; Rows 0 grows as you add. Each tab can override Columns/Rows (0 = use the section's).</p>
        <p className="help">Use "Add group" in the section header to place a block that spans several cells and holds its own smaller grid of buttons — a way to fit more pads into a small grid.</p>
        <p className="help">MIDI output and channel here are the section's fallback — used by any tab that leaves its own output/channel on "Global". A button's own Channel field overrides everything.</p>
        <p className="help">Pad tabs split a section's buttons into switchable pages — handy when you have more pads than fit on screen, or want each page on its own MIDI output/channel (e.g. a plugin tab routed to its own port). Tabs only show in the section header once there's more than one.</p>
      </div>
    );
  }

  if (sel.kind === "faderGroup") {
    const fg = config.faderGroup || { outputName: "", channel: 0 };
    const set = <K extends keyof FaderGroup>(k: K, v: FaderGroup[K]) => update(d => { if (!d.faderGroup) d.faderGroup = { outputName: "", channel: 0 }; d.faderGroup[k] = v; });
    return (
      <div className="drawer">
        <h3>Knobs &amp; faders <button className="tb" onClick={close}>Close</button></h3>
        <div className="two">
          <Field label="MIDI output"><OutputSelect value={fg.outputName} outputs={outputs} onChange={v => set("outputName", v)} /></Field>
          <Field label="Channel"><ChannelSelect value={fg.channel || 0} onChange={v => set("channel", v)} /></Field>
        </div>
        <p className="help">Sets the default output and channel for every knob in the strip. Each knob's own Channel field (in its editor) still overrides this.</p>
      </div>
    );
  }
  return null;
}
