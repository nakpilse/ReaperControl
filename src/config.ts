import type { Config, EffItem, Fader, PadItem, Page, Section } from "./types";

export const FILE_NAME = "reaper-midi-layout.json";
export const LS_KEY = "reaper-midi-layout";
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
export const noteName = (n: number) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const uid = () => Math.random().toString(36).slice(2, 9);

// Block colours (keys kept compatible with earlier saved layouts)
export const COLORS: Record<string, string> = {
  pad: "#8A929B", sand: "#F5A623", rose: "#E8504A", mint: "#3FC57A",
  sky: "#3A9BE8", lilac: "#9B6BE8", cyan: "#3ECFD6", orange: "#F07F3C",
};

// Standard gamepad mapping (GPD Win 4 in gamepad mode)
export const GP_BUTTONS = ["A","B","X","Y","LB","RB","LT","RT","View","Menu","LS","RS","Up","Down","Left","Right"];
export const GP_AXES = ["LX","LY","RX","RY","LT","RT"];
export const GP_AXIS_INDEX: Record<string, number> = { LX: 0, LY: 1, RX: 2, RY: 3 };

export const btn = (o: Partial<PadItem>): PadItem => ({ id: uid(), label: "New", type: "note", num: 60, value: "", off: 0, mode: "momentary",
                      channel: 0, color: "pad", key: "", gamepad: "", ...o });
export const fdr = (o: Partial<Fader>): Fader => ({ id: uid(), label: "Knob", type: "cc", cc: 1, value: 0, channel: 0, axis: "", invert: false, color: "sand", ...o });

// Resolves a button against its page's (then its section's) MIDI output/channel
// defaults — the button's own channel, if set, wins over both; a page's own
// output/channel, if set, wins over its section's.
const pageFor = (s: Section, b: PadItem): Page | null => (s.pages && (s.pages.find(p => p.id === b.pageId) || s.pages[0])) || null;
export const effItem = (s: Section, b: PadItem): EffItem => {
  const p = pageFor(s, b);
  return { ...b,
    channel: b.channel || (p && p.channel) || s.channel || 0,
    outputName: (p && p.outputName) || s.outputName || "" };
};

// A section with no pages (or an item whose page no longer exists) falls back to
// its first page — keeps older saved layouts (from before pad tabs existed) working.
const pageOf = (s: Section): Page | null => (s.pages && s.pages.find(p => p.id === s.activePage)) || (s.pages && s.pages[0]) || null;
export const itemsOnPage = (s: Section): PadItem[] => {
  const p = pageOf(s);
  return p ? s.items.filter(b => (b.pageId || (s.pages![0] && s.pages![0].id)) === p.id) : s.items;
};

// The active tab's grid — a tab's own cols/rows, if set, win over its section's.
// rows 0 = auto (grows with the buttons), so only a fixed row count caps the page.
export const gridOf = (s: Section): { cols: number; rows: number } => {
  const p = pageOf(s);
  return { cols: (p && p.cols) || s.cols, rows: (p && p.rows) || s.rows || 0 };
};
export const pageCapacity = (s: Section): number => { const g = gridOf(s); return g.rows ? g.cols * g.rows : Infinity; };

// Helix Native MIDI implementation (Line 6 Helix MIDI/OSC reference): Program
// Change selects presets 1:1 (PC 0 = preset 1, etc). CC#69 (values 0-7) selects
// Snapshots 1-8 — this is Helix's fixed/global snapshot controller, not
// something you need to MIDI-learn. CC#64 is Tap Tempo (any value >=64 taps).
// Per-footswitch/stomp CCs are user-assignable in Helix Native itself, so they
// aren't included here — add them with "Add button" once you've set them up
// in Helix's Command Center. Offered as an optional preset tab, not a forced
// default, via "Add Helix Native tab".
export function makeHelixPage(): { page: Page; items: PadItem[] } {
  const page: Page = { id: uid(), title: "Helix Native", outputName: "", channel: 0 };
  const items = [
    ...Array.from({ length: 8 }, (_, i) => btn({ label: "Preset " + (i + 1), type: "pc", num: i, color: "sky", pageId: page.id })),
    ...Array.from({ length: 8 }, (_, i) => btn({ label: "Snapshot " + (i + 1), type: "cc", num: 69, value: i, off: i, mode: "trigger", color: "mint", pageId: page.id })),
    btn({ label: "Tap Tempo", type: "cc", num: 64, value: 127, mode: "trigger", color: "sand", pageId: page.id }),
  ];
  return { page, items };
}

export function makeDefault(): Config {
  const padKeys = ["a","s","d","f","g","h","j","k","q","w","e","r","t","y","u","i"];
  const padPad: Record<number, string> = { 36: "A", 38: "B", 42: "X", 46: "Y", 49: "LB", 51: "RB" };
  const padColor = (n: number) => n === 36 ? "rose" : n === 38 ? "sand" : n === 42 || n === 46 ? "cyan" : n >= 49 ? "lilac" : "sky";
  const transportPage: Page = { id: uid(), title: "1", outputName: "", channel: 0 };
  const padsPage: Page = { id: uid(), title: "1", outputName: "", channel: 0 };
  return {
    version: 2,
    settings: { name: "REAPER Control", outputName: "", channel: 1, velocity: 100 },
    faderGroup: { outputName: "", channel: 0 },
    sections: [
      { id: uid(), title: "Transport", cols: 6, outputName: "", channel: 0,
        pages: [transportPage], activePage: transportPage.id, items: [
        btn({ label: "Play",   type: "cc", num: 20, value: 127, mode: "trigger", color: "mint", key: "space", gamepad: "Menu", pageId: transportPage.id }),
        btn({ label: "Stop",   type: "cc", num: 21, value: 127, mode: "trigger", gamepad: "View", pageId: transportPage.id }),
        btn({ label: "Record", type: "cc", num: 22, value: 127, mode: "trigger", color: "rose", pageId: transportPage.id }),
        btn({ label: "Rewind", type: "cc", num: 23, value: 127, mode: "trigger", gamepad: "Left", pageId: transportPage.id }),
        btn({ label: "Loop",   type: "cc", num: 24, value: 127, mode: "trigger", color: "sky", pageId: transportPage.id }),
        btn({ label: "Undo",   type: "cc", num: 25, value: 127, mode: "trigger", color: "orange", pageId: transportPage.id }),
      ]},
      { id: uid(), title: "Pads", cols: 8, outputName: "", channel: 0,
        pages: [padsPage], activePage: padsPage.id, items: [
        ...Array.from({ length: 8 }, (_, i) => 44 + i),
        ...Array.from({ length: 8 }, (_, i) => 36 + i),
      ].map(n => btn({ label: noteName(n), num: n, color: padColor(n), key: padKeys[n - 36] || "", gamepad: padPad[n] || "", pageId: padsPage.id })) },
    ],
    faders: [
      fdr({ label: "Volume", cc: 7, value: 100, color: "sand" }),
      fdr({ label: "Pan", cc: 10, value: 64, axis: "LX", color: "sky" }),
      fdr({ label: "Mod", cc: 1, value: 0, axis: "RT", color: "lilac" }),
      fdr({ label: "Expression", cc: 11, value: 127, color: "mint" }),
      fdr({ label: "Cutoff", cc: 74, value: 64, axis: "RX", color: "orange" }),
      fdr({ label: "Pitch bend", type: "pb", value: 8192, axis: "LY", color: "cyan" }),
    ],
  };
}

export const validConfig = (c: unknown): c is Config => {
  const x = c as Partial<Config> | null;
  return !!x && Array.isArray(x.sections) && Array.isArray(x.faders) && !!x.settings;
};

export const findBtn = (d: Config, id: string): { s: Section; i: number } | null => {
  for (const s of d.sections) { const i = s.items.findIndex(b => b.id === id); if (i >= 0) return { s, i }; }
  return null;
};

export const faderMax =(f: Fader) => f.type === "pb" ? 16383 : 127;
