export type ButtonType = "note" | "cc" | "pc";
export type ButtonMode = "momentary" | "toggle" | "trigger";
export type FaderType = "cc" | "pb";
export type FaderStyle = "knob" | "fader";

export interface PadItem {
  id: string;
  label: string;
  type: ButtonType;
  num: number;
  /** "" = default (global velocity for notes, 127 for CC) */
  value: number | "";
  off: number;
  mode: ButtonMode;
  /** 0 = inherit from page/section/global */
  channel: number;
  color: string;
  key: string;
  gamepad: string;
  pageId?: string;
}

/** A button resolved against its page/section output and channel defaults. */
export interface EffItem extends PadItem {
  outputName: string;
}

export interface Fader {
  id: string;
  label: string;
  type: FaderType;
  cc: number;
  value: number;
  channel: number;
  axis: string;
  invert: boolean;
  color: string;
  /** How it's drawn in the strip; missing = "knob" (older layouts) */
  style?: FaderStyle;
}

export interface Page {
  id: string;
  title: string;
  outputName: string;
  channel: number;
}

export interface Section {
  id: string;
  title: string;
  cols: number;
  rows?: number;
  outputName: string;
  channel: number;
  pages?: Page[];
  activePage?: string;
  items: PadItem[];
}

export interface Settings {
  name: string;
  outputName: string;
  channel: number;
  velocity: number;
}

export interface FaderGroup {
  outputName: string;
  channel: number;
}

export interface Config {
  version?: number;
  settings: Settings;
  faderGroup?: FaderGroup;
  sections: Section[];
  faders: Fader[];
}

export type Selection =
  | { kind: "button" | "fader" | "section"; id: string }
  | { kind: "faderGroup"; id?: undefined };

export type UpdateConfig = (fn: (draft: Config) => void) => void;
