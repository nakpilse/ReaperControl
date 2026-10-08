import { useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent } from "react";
import { Editor } from "./components/Editor";
import { Knob } from "./components/Knob";
import { PadButton } from "./components/PadButton";
import { PadGroup } from "./components/PadGroup";
import { SaveDialog } from "./components/SaveDialog";
import { Slider } from "./components/Slider";
import {
  blocksOnPage, btn, cellsUsed, clamp, effItem, faderMax, fdr, FILE_NAME, GP_AXIS_INDEX, GP_BUTTONS, gridOf, groupCapacity,
  groupItems, grp, LS_KEY, makeDefault, makeHelixPage, noteName, pageCapacity, playableOnPage, spanOf, uid, validConfig,
} from "./config";
import type { ClockState, Config, EffItem, FaderStyle, PadItem, Page, Section, Selection, Settings, UpdateConfig } from "./types";

const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);

export function App() {
  const [config, setConfig] = useState<Config>(() => {
    try { const c = JSON.parse(localStorage.getItem(LS_KEY) ?? "null"); if (validConfig(c)) return c; } catch {}
    return makeDefault();
  });
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [clock, setClock] = useState<ClockState>({ bpm: null, playing: false, pos: 0 });
  const [midiErr, setMidiErr] = useState("");
  const [last, setLast] = useState("Ready");
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [gpName, setGpName] = useState("");
  const [isFull, setIsFull] = useState(false);
  const [, force] = useReducer((x: number) => x + 1, 0);

  const activeRef = useRef<Record<string, boolean>>({});
  const cfgRef = useRef(config); cfgRef.current = config;
  const editRef = useRef(edit); editRef.current = edit;
  const importRef = useRef<HTMLInputElement>(null);

  const update: UpdateConfig = useCallback(fn => setConfig(c => { const d = structuredClone(c); fn(d); return d; }), []);

  // ---------- MIDI ----------
  useEffect(() => {
    if (!navigator.requestMIDIAccess) { setMidiErr("Web MIDI needs Chrome or Edge"); return; }
    navigator.requestMIDIAccess().then(acc => {
      const refresh = () => { setOutputs([...acc.outputs.values()]); setInputs([...acc.inputs.values()]); };
      refresh(); acc.onstatechange = refresh;
    }).catch(e => setMidiErr("MIDI blocked: " + errMsg(e)));
  }, []);

  // ---------- MIDI in (clock from REAPER) ----------
  // REAPER sends 24 clock ticks per quarter note plus Start/Continue/Stop and
  // Song Position Pointer to any output with "Send clock/SPP" enabled. Tempo is
  // averaged over the last beat of ticks; position counts 16ths (6 ticks each).
  // MIDI clock carries no time signature, so bar.beat assumes 4/4.
  const input = inputs.find(i => i.name === config.settings.inputName) || null;
  useEffect(() => {
    if (!input) { setClock({ bpm: null, playing: false, pos: 0 }); return; }
    const ticks: number[] = []; let playing = false; let pos = 0; let sub = 0; let raf = 0;
    const publish = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const n = ticks.length; const bpm = n > 1 ? Math.round(600000 * (n - 1) / ((ticks[n - 1] - ticks[0]) * 24)) / 10 : null;
        setClock(c => c.bpm === bpm && c.playing === playing && c.pos === pos ? c : { bpm, playing, pos });
      });
    };
    const onMsg = (e: MIDIMessageEvent) => {
      const d = e.data; if (!d || !d.length) return;
      switch (d[0]) {
        case 0xF8: ticks.push(e.timeStamp); if (ticks.length > 25) ticks.shift();
          if (playing && ++sub === 6) { sub = 0; pos++; } break;
        case 0xFA: playing = true; pos = 0; sub = 0; break;
        case 0xFB: playing = true; break;
        case 0xFC: playing = false; break;
        case 0xF2: pos = d[1] | (d[2] << 7); sub = 0; break;
        default: return;
      }
      publish();
    };
    // No ticks for a second = clock stopped (REAPER only sends it while playing by default)
    const idle = setInterval(() => { if (ticks.length && performance.now() - ticks[ticks.length - 1] > 1000) { ticks.length = 0; publish(); } }, 500);
    input.addEventListener("midimessage", onMsg);
    return () => { input.removeEventListener("midimessage", onMsg); clearInterval(idle); cancelAnimationFrame(raf); };
  }, [input]);

  const output = outputs.find(o => o.name === config.settings.outputName)
    || outputs.find(o => /loop|iac|virtual/i.test(o.name ?? "")) || outputs[0] || null;
  const outRef = useRef(output); outRef.current = output;

  // Resolves a section/knob-group's chosen output name to a live MIDI output,
  // falling back to the global default (top bar) when unset or disconnected.
  const pickOutput = useCallback((name?: string) => (name && outputs.find(o => o.name === name)) || outRef.current, [outputs]);

  const sendRaw = useCallback((outObj: MIDIOutput | null, bytes: number[], desc: string) => {
    if (!outObj) { setLast("No MIDI output — " + desc); return; }
    outObj.send(bytes);
    setLast(desc + "   " + bytes.map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" "));
  }, []);

  const chOf = (item: { channel: number }, groupChannel?: number) => ((item.channel || groupChannel || cfgRef.current.settings.channel) - 1) & 15;

  const sendOn = (b: EffItem) => {
    const out = pickOutput(b.outputName); const ch = chOf(b);
    if (b.type === "note") { const v = b.value === "" ? cfgRef.current.settings.velocity : +b.value;
      sendRaw(out, [0x90 | ch, b.num, clamp(v, 1, 127)], `Ch ${ch + 1}  Note On ${noteName(b.num)}  vel ${v}`); }
    else if (b.type === "cc") { const v = b.value === "" ? 127 : +b.value; sendRaw(out, [0xB0 | ch, b.num, v], `Ch ${ch + 1}  CC ${b.num} = ${v}`); }
    else if (b.type === "pc") sendRaw(out, [0xC0 | ch, b.num], `Ch ${ch + 1}  Program ${b.num}`);
  };
  const sendOff = (b: EffItem) => {
    const out = pickOutput(b.outputName); const ch = chOf(b);
    if (b.type === "note") sendRaw(out, [0x80 | ch, b.num, 0], `Ch ${ch + 1}  Note Off ${noteName(b.num)}`);
    else if (b.type === "cc") sendRaw(out, [0xB0 | ch, b.num, +b.off || 0], `Ch ${ch + 1}  CC ${b.num} = ${+b.off || 0}`);
  };
  const setActive = (id: string, v: boolean) => { activeRef.current[id] = v; force(); };

  const press = (b: EffItem) => {
    if (b.type === "pc") { sendOn(b); setActive(b.id, true); setTimeout(() => setActive(b.id, false), 120); return; }
    if (b.mode === "toggle") { const on = !activeRef.current[b.id]; if (on) sendOn(b); else sendOff(b); setActive(b.id, on); return; }
    if (activeRef.current[b.id] && b.mode === "momentary") return;
    sendOn(b); setActive(b.id, true);
    if (b.mode === "trigger") setTimeout(() => { sendOff(b); setActive(b.id, false); }, b.type === "note" ? 120 : 40);
  };
  const release = (b: EffItem) => {
    if (b.mode === "momentary" && b.type !== "pc" && activeRef.current[b.id]) { sendOff(b); setActive(b.id, false); }
  };
  const pressRef = useRef(press); pressRef.current = press;
  const releaseRef = useRef(release); releaseRef.current = release;

  const setFader = useCallback((id: string, v: number) => {
    const f = cfgRef.current.faders.find(x => x.id === id); if (!f || f.value === v) return;
    const grp = cfgRef.current.faderGroup || { outputName: "", channel: 0 };
    const out = pickOutput(grp.outputName); const ch = chOf(f, grp.channel);
    if (f.type === "pb") sendRaw(out, [0xE0 | ch, v & 0x7F, (v >> 7) & 0x7F], `Ch ${ch + 1}  Pitch Bend ${v - 8192}`);
    else sendRaw(out, [0xB0 | ch, f.cc, v], `Ch ${ch + 1}  CC ${f.cc} = ${v}`);
    update(d => { const x = d.faders.find(x => x.id === id); if (x) x.value = v; });
  }, [update, sendRaw, pickOutput]);
  const setFaderRef = useRef(setFader); setFaderRef.current = setFader;

  const panic = () => {
    const outs = new Set<MIDIOutput>();
    if (outRef.current) outs.add(outRef.current);
    cfgRef.current.sections.forEach(s => { const o = pickOutput(s.outputName); if (o) outs.add(o); });
    const fg = cfgRef.current.faderGroup; const fo = pickOutput(fg && fg.outputName); if (fo) outs.add(fo);
    if (!outs.size) return;
    outs.forEach(o => { for (let c = 0; c < 16; c++) { o.send([0xB0 | c, 123, 0]); o.send([0xB0 | c, 120, 0]); } });
    activeRef.current = {}; force();
    setLast("Panic — All Notes Off and All Sound Off on 16 channels" + (outs.size > 1 ? ` across ${outs.size} outputs` : ""));
  };

  // ---------- saving ----------
  const writeLocal = (cfg: Config) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); return true; }
    catch (e) { setSaveMsg("Save failed: " + errMsg(e)); return false; }
  };

  const [saveOpen, setSaveOpen] = useState(false);
  const openSave = () => setSaveOpen(true);
  const openSaveRef = useRef(openSave); openSaveRef.current = openSave;

  const save = (name: string, reload: boolean) => {
    const cfg = structuredClone(cfgRef.current); cfg.settings.name = name;
    setConfig(cfg); setSaveOpen(false);
    if (!writeLocal(cfg)) return;
    if (reload) { setSaveMsg("Saved in browser — reloading…"); setTimeout(() => location.reload(), 300); }
    else setSaveMsg("Saved in browser");
  };

  // ---------- computer keyboard ----------
  useEffect(() => {
    const keyOf = (e: KeyboardEvent) => e.key === " " ? "space" : e.key.toLowerCase();
    const all = () => cfgRef.current.sections.flatMap(s => playableOnPage(s).map(b => effItem(s, b)));
    const down = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); openSaveRef.current(); return; }
      if (editRef.current || (e.target instanceof Element && e.target.closest("input,select,textarea"))) return;
      const hits = all().filter(b => b.key && b.key === keyOf(e));
      if (!hits.length) return;
      e.preventDefault(); if (e.repeat) return;
      hits.forEach(b => pressRef.current(b));
    };
    const up = (e: KeyboardEvent) => {
      if (editRef.current) return;
      all().filter(b => b.key && b.key === keyOf(e)).forEach(b => releaseRef.current(b));
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // ---------- gamepad (GPD Win 4 controls) ----------
  useEffect(() => {
    let raf = 0; const prevBtn: boolean[] = []; const prevAxis: Record<string, number> = {}; let lastName = "";
    const loop = () => {
      const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
      const name = gp ? gp.id : "";
      if (name !== lastName) { lastName = name; setGpName(name); }
      if (gp && !editRef.current) {
        const cfg = cfgRef.current; const all = cfg.sections.flatMap(s => playableOnPage(s).map(b => effItem(s, b)));
        gp.buttons.forEach((b, i) => {
          const p = b.pressed; if (p === prevBtn[i]) return; prevBtn[i] = p;
          const label = GP_BUTTONS[i]; if (!label) return;
          all.filter(x => x.gamepad === label).forEach(x => p ? pressRef.current(x) : releaseRef.current(x));
        });
        cfg.faders.forEach(f => {
          if (!f.axis) return;
          const max = faderMax(f); let t: number;
          if (f.axis === "LT" || f.axis === "RT") { const b = gp.buttons[f.axis === "LT" ? 6 : 7]; if (!b) return; t = b.value; }
          else {
            let raw = gp.axes[GP_AXIS_INDEX[f.axis]]; if (raw == null) return;
            if (Math.abs(raw) < 0.08) raw = 0;
            t = f.axis.endsWith("Y") ? (1 - raw) / 2 : (raw + 1) / 2;
          }
          if (f.invert) t = 1 - t;
          const v = Math.round(clamp(t, 0, 1) * max);
          if (prevAxis[f.id] !== v) { prevAxis[f.id] = v; setFaderRef.current(f.id, v); }
        });
      }
      raf = requestAnimationFrame(loop);
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, []);

  // autosave to the browser on every change
  useEffect(() => { writeLocal(config); }, [config]);

  const exportJson = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
    a.download = FILE_NAME; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const c: unknown = JSON.parse(await f.text()); if (!validConfig(c)) throw new Error("not a layout file"); setConfig(c); setSaveMsg("Imported " + f.name); }
    catch (err) { alert("Import failed: " + errMsg(err)); }
    e.target.value = "";
  };

  // ---------- fullscreen ----------
  useEffect(() => { const h = () => setIsFull(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);
  const toggleFull = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: "hide" });

  // ---------- edit mode ----------
  // Snapshot taken on entering edit mode so Cancel can roll back every change
  const editSnapRef = useRef<Config | null>(null);
  const startEdit = () => { editSnapRef.current = structuredClone(cfgRef.current); setSel(null); setEdit(true); };
  const finishEdit = () => { editSnapRef.current = null; setSel(null); setEdit(false); };
  const cancelEdit = () => {
    const snap = editSnapRef.current;
    if (snap) { setConfig(snap); setSaveMsg("Edits discarded"); }
    finishEdit();
  };

  // ---------- edit helpers ----------
  // Adds a button or a 1×1 group to the active tab, if its grid has a free cell
  const addBlock = (secId: string, b: PadItem) => {
    const s = cfgRef.current.sections.find(x => x.id === secId);
    if (!s || cellsUsed(s) >= pageCapacity(s)) return;
    update(d => { const s = d.sections.find(x => x.id === secId)!; b.pageId = s.activePage; s.items.push(b); });
    setSel({ kind: "button", id: b.id });
  };
  const addButton = (secId: string) => addBlock(secId, btn({}));
  const addGroup = (secId: string) => addBlock(secId, grp({}));
  const addToGroup = (secId: string, gid: string) => {
    const s = cfgRef.current.sections.find(x => x.id === secId); const g = s?.items.find(x => x.id === gid);
    if (!s || !g || groupItems(s, gid).length >= groupCapacity(g)) return;
    const b = btn({ pageId: g.pageId, groupId: gid });
    update(d => { d.sections.find(x => x.id === secId)!.items.push(b); });
    setSel({ kind: "button", id: b.id });
  };
  const addSection = () => { const s: Section = { id: uid(), title: "New section", cols: 4, outputName: "", channel: 0, items: [] }; update(d => { d.sections.push(s); }); setSel({ kind: "section", id: s.id }); };
  const addFader = (style: FaderStyle = "knob") => { const f = fdr(style === "fader" ? { style, label: "Fader" } : {}); update(d => { d.faders.push(f); }); setSel({ kind: "fader", id: f.id }); };
  const setS = <K extends keyof Settings>(k: K, v: Settings[K]) => update(d => { d.settings[k] = v; });

  // ---------- pad tabs (pages within a section) ----------
  const findSec = (d: Config, secId: string) => d.sections.find(s => s.id === secId)!;
  const setPage = (secId: string, pageId: string) => update(d => { findSec(d, secId).activePage = pageId; });
  // Migrates a legacy, un-paged section into a single page "1" holding all its
  // existing buttons — only happens the first time a section grows a second tab.
  const ensurePaged = (s: Section): Page[] => {
    if (s.pages && s.pages.length) return s.pages;
    const p0: Page = { id: uid(), title: "1", outputName: "", channel: 0 };
    s.items.forEach(b => { b.pageId = p0.id; });
    s.pages = [p0]; s.activePage = p0.id;
    return s.pages;
  };
  const addPage = (secId: string) => update(d => {
    const s = findSec(d, secId);
    const pages = ensurePaged(s);
    const np: Page = { id: uid(), title: String(pages.length + 1), outputName: "", channel: 0 };
    pages.push(np); s.activePage = np.id;
  });
  const addHelixTab = (secId: string) => update(d => {
    const s = findSec(d, secId);
    const pages = ensurePaged(s);
    const { page, items } = makeHelixPage();
    pages.push(page); s.items.push(...items); s.activePage = page.id;
  });
  const renamePage = (secId: string, pageId: string, title: string) => update(d => {
    findSec(d, secId).pages!.find(p => p.id === pageId)!.title = title;
  });
  const setPageField = <K extends "outputName" | "channel" | "cols" | "rows">(secId: string, pageId: string, key: K, val: Page[K]) => update(d => {
    findSec(d, secId).pages!.find(p => p.id === pageId)![key] = val;
  });
  const deletePage = (secId: string, pageId: string) => update(d => {
    const s = findSec(d, secId); const pages = s.pages!; if (pages.length <= 1) return;
    s.items = s.items.filter(b => (b.pageId || pages[0].id) !== pageId);
    s.pages = pages.filter(p => p.id !== pageId);
    if (s.activePage === pageId) s.activePage = s.pages[0].id;
  });

  const status = midiErr ? "err" : output ? "on" : "";

  return (
    <div className={"app" + (edit ? " edit" : "")}>
      <header className="head">
        <div className="preset">
          <span className="name">{config.settings.name || "REAPER Control"}</span>
          <span className="route"><span className={"dot " + status}></span>{midiErr || (output ? output.name : "No MIDI output")}</span>
        </div>
        <select className="out" value={output?.name ?? ""} onChange={e => setS("outputName", e.target.value)} title="MIDI output">
          {outputs.length === 0 && <option value="">{midiErr || "No MIDI outputs"}</option>}
          {outputs.map(o => <option key={o.id} value={o.name ?? ""}>{o.name}</option>)}
        </select>
        <select className="out" value={input?.name ?? ""} onChange={e => setS("inputName", e.target.value)} title="MIDI input for clock from REAPER (tempo/transport)">
          <option value="">No clock input</option>
          {inputs.map(i => <option key={i.id} value={i.name ?? ""}>{i.name}</option>)}
        </select>
        {input && <div className={"clock" + (clock.playing ? " on" : "")} title="Tempo and position from REAPER's MIDI clock (bar.beat assumes 4/4)">
          <span className="bpm">{clock.bpm != null ? clock.bpm.toFixed(1) : "—"}</span><small>BPM</small>
          <span>{clock.playing ? "▶" : "■"} {Math.floor(clock.pos / 16) + 1}.{Math.floor(clock.pos / 4) % 4 + 1}</span>
        </div>}
        <select value={config.settings.channel} onChange={e => setS("channel", +e.target.value)} title="Global channel">
          {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>Ch {i + 1}</option>)}
        </select>
        <input className="narrow" type="number" min="1" max="127" value={config.settings.velocity} title="Default velocity"
          onChange={e => setS("velocity", clamp(+e.target.value || 1, 1, 127))} />
        <div className="lcd">
          <span>{last}</span>
          {gpName && <span className="pad-ico" title={gpName}>🎮</span>}
        </div>
        <button className={"tb" + (edit ? " on" : "")} onClick={edit ? finishEdit : startEdit}>{edit ? "Done" : "Edit"}</button>
        {edit && <button className="tb" onClick={cancelEdit} title="Discard changes made since entering edit mode">Cancel</button>}
        <button className="tb" onClick={toggleFull}>{isFull ? "Exit full" : "Fullscreen"}</button>
        <button className="tb danger" onClick={panic}>Panic</button>
      </header>

      {edit ? (
        <div className="tools">
          <button className="tb primary" onClick={openSave} title="Save layout (Ctrl+S)">Save</button>
          <button className="tb" onClick={addSection}>Add section</button>
          <button className="tb" onClick={() => addFader("knob")}>Add knob</button>
          <button className="tb" onClick={() => addFader("fader")}>Add fader</button>
          <button className="tb" onClick={exportJson}>Export</button>
          <button className="tb" onClick={() => importRef.current?.click()}>Import</button>
          <button className="tb" onClick={() => { if (confirm("Reset to the default layout?")) { setConfig(makeDefault()); setSel(null); } }}>Reset</button>
          <span className="chip">{saveMsg}</span>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importJson} />
        </div>
      ) : <div></div>}

      <main className="deck">
        {config.sections.map(s => {
          const blocks = blocksOnPage(s);
          const g = gridOf(s); const cols = g.cols;
          const used = cellsUsed(s);
          const tallest = blocks.reduce((m, b) => Math.max(m, spanOf(b, cols).r), 1);
          const rows = g.rows || Math.max(tallest, Math.ceil(used / cols));
          const cap = pageCapacity(s); const full = used >= cap;
          const pad = (b: PadItem) => {
            const eff = effItem(s, b);
            return (
              <PadButton key={b.id} b={b} lit={!!activeRef.current[b.id]} edit={edit}
                selected={sel?.id === b.id}
                onSelect={() => setSel({ kind: "button", id: b.id })}
                onPress={() => press(eff)} onRelease={() => release(eff)} />
            );
          };
          return (
            <div className="section" key={s.id} style={{ flex: `${rows} 1 0` }}>
              <div className="lane">
                <span className="tag">{s.title}</span>
                {s.pages && s.pages.length > 1 && s.pages.map(p => (
                  <button key={p.id} className={"tb" + (s.activePage === p.id ? " on" : "")} onClick={() => setPage(s.id, p.id)}>{p.title}</button>
                ))}
                {edit && <>
                  <button className={"tb" + (sel?.id === s.id ? " on" : "")} onClick={() => setSel({ kind: "section", id: s.id })}>Edit section</button>
                  <button className="tb" onClick={() => addButton(s.id)} disabled={full}
                    title={full ? `Grid is full (${cols} × ${rows}) — raise Columns/Rows or set Rows to 0 for auto` : undefined}>
                    Add button{cap !== Infinity ? ` (${used}/${cap})` : ""}
                  </button>
                  <button className="tb" onClick={() => addGroup(s.id)} disabled={full}
                    title={full ? `Grid is full (${cols} × ${rows})` : "Add a group: a block with its own smaller grid of buttons"}>
                    Add group
                  </button>
                </>}
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gridAutoFlow: "row dense" }}>
                {blocks.map(b => {
                  if (!b.group) return pad(b);
                  const kids = groupItems(s, b.id);
                  return (
                    <PadGroup key={b.id} g={b} span={spanOf(b, cols)} count={kids.length} edit={edit}
                      selected={sel?.id === b.id} full={kids.length >= groupCapacity(b)}
                      onSelect={() => setSel({ kind: "button", id: b.id })} onAdd={() => addToGroup(s.id, b.id)}>
                      {kids.map(pad)}
                    </PadGroup>
                  );
                })}
              </div>
            </div>
          );
        })}
      </main>

      <footer className="strip">
        {config.faders.map(f => {
          const Ctl = f.style === "fader" ? Slider : Knob;
          return <Ctl key={f.id} f={f} max={faderMax(f)} edit={edit} selected={sel?.id === f.id}
            onSelect={() => setSel({ kind: "fader", id: f.id })} onChange={v => setFader(f.id, v)} />;
        })}
        {edit && <>
          <button className={"tb" + (sel?.kind === "faderGroup" ? " on" : "")} onClick={() => setSel({ kind: "faderGroup" })}>Edit knobs</button>
          <button className="tb add-knob" onClick={() => addFader("knob")}>Add knob</button>
          <button className="tb add-knob" onClick={() => addFader("fader")}>Add fader</button>
        </>}
      </footer>

      {edit && sel && <Editor sel={sel} config={config} update={update} close={() => setSel(null)} setSel={setSel} outputs={outputs}
        addToGroup={addToGroup} addPage={addPage} addHelixTab={addHelixTab} renamePage={renamePage} setPageField={setPageField} deletePage={deletePage} />}
      {saveOpen && <SaveDialog name={config.settings.name || ""} onSave={save} onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
