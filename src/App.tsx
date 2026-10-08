import { useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent } from "react";
import { Editor } from "./components/Editor";
import { Knob } from "./components/Knob";
import { PadButton } from "./components/PadButton";
import { Slider } from "./components/Slider";
import {
  btn, clamp, effItem, faderMax, fdr, FILE_NAME, GP_AXIS_INDEX, GP_BUTTONS, itemsOnPage, LS_KEY,
  makeDefault, makeHelixPage, noteName, uid, validConfig,
} from "./config";
import { idb } from "./idb";
import type { Config, EffItem, FaderStyle, Page, Section, Selection, Settings, UpdateConfig } from "./types";

type FolderState = "none" | "prompt" | "connected";

const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function App() {
  const [config, setConfig] = useState<Config>(() => {
    try { const c = JSON.parse(localStorage.getItem(LS_KEY) ?? "null"); if (validConfig(c)) return c; } catch {}
    return makeDefault();
  });
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);
  const [midiErr, setMidiErr] = useState("");
  const [last, setLast] = useState("Ready");
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderState, setFolderState] = useState<FolderState>("none");
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
      const refresh = () => setOutputs([...acc.outputs.values()]);
      refresh(); acc.onstatechange = refresh;
    }).catch(e => setMidiErr("MIDI blocked: " + errMsg(e)));
  }, []);

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
  const writeFolder = async (h: FileSystemDirectoryHandle, cfg: Config) => {
    const fh = await h.getFileHandle(FILE_NAME, { create: true });
    const w = await fh.createWritable(); await w.write(JSON.stringify(cfg, null, 2)); await w.close();
  };
  const readFolder = async (h: FileSystemDirectoryHandle) => {
    try { const fh = await h.getFileHandle(FILE_NAME); const c: unknown = JSON.parse(await (await fh.getFile()).text());
          return validConfig(c) ? c : null; } catch { return null; }
  };

  const save = async () => {
    const cfg = cfgRef.current;
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    if (folder && folderState === "connected") {
      try { await writeFolder(folder, cfg); setSaveMsg("Saved to " + folder.name + "/" + FILE_NAME); }
      catch (e) { setSaveMsg("Folder save failed: " + errMsg(e)); }
    } else setSaveMsg("Saved in browser only — link a folder to save a file");
  };
  const saveRef = useRef(save); saveRef.current = save;

  // ---------- computer keyboard ----------
  useEffect(() => {
    const keyOf = (e: KeyboardEvent) => e.key === " " ? "space" : e.key.toLowerCase();
    const all = () => cfgRef.current.sections.flatMap(s => itemsOnPage(s).map(b => effItem(s, b)));
    const down = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(); return; }
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
        const cfg = cfgRef.current; const all = cfg.sections.flatMap(s => itemsOnPage(s).map(b => effItem(s, b)));
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

  // load folder handle on start
  useEffect(() => { (async () => {
    try {
      const h = await idb.get<FileSystemDirectoryHandle>("dir"); if (!h) return;
      setFolder(h);
      if ((await h.queryPermission({ mode: "readwrite" })) === "granted") {
        const c = await readFolder(h); if (c) setConfig(c);
        setFolderState("connected"); setSaveMsg("Loaded from " + h.name);
      } else setFolderState("prompt");
    } catch {}
  })(); }, []);

  // autosave: browser immediately, folder after a pause
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(config));
    if (!(folder && folderState === "connected")) return;
    setSaveMsg("Saving…");
    const t = setTimeout(() => writeFolder(folder, config)
      .then(() => setSaveMsg("Saved to " + folder.name))
      .catch(e => setSaveMsg("Folder save failed: " + errMsg(e))), 700);
    return () => clearTimeout(t);
  }, [config, folder, folderState]);

  const linkFolder = async () => {
    if (!window.showDirectoryPicker) { alert("Folder saving needs Chrome or Edge. Use Export instead."); return; }
    try {
      const h = await window.showDirectoryPicker({ id: "reaper-midi", mode: "readwrite" });
      await idb.set("dir", h); setFolder(h);
      const existing = await readFolder(h);
      if (existing && confirm(`Found ${FILE_NAME} in "${h.name}". Load it?\n\nOK = load the file\nCancel = overwrite it with the current layout`)) setConfig(existing);
      else await writeFolder(h, cfgRef.current);
      setFolderState("connected"); setSaveMsg("Linked to " + h.name);
    } catch (e) { if (!isAbort(e)) setSaveMsg("Couldn't link folder: " + errMsg(e)); }
  };
  const reconnect = async () => {
    if (!folder || (await folder.requestPermission({ mode: "readwrite" })) !== "granted") return;
    const c = await readFolder(folder); if (c) setConfig(c);
    setFolderState("connected"); setSaveMsg("Reconnected to " + folder.name);
  };
  const unlink = async () => { await idb.del("dir"); setFolder(null); setFolderState("none"); setSaveMsg("Folder unlinked"); };

  // Save the current layout to the folder file, then reload the page from it
  const saveAndReload = async () => {
    const cfg = cfgRef.current;
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    try {
      let h = folder;
      if (!h) {
        if (!window.showDirectoryPicker) { setSaveMsg("Saved in browser — reloading…"); setTimeout(() => location.reload(), 300); return; }
        h = await window.showDirectoryPicker({ id: "reaper-midi", mode: "readwrite" });
        await idb.set("dir", h);
      } else if ((await h.queryPermission({ mode: "readwrite" })) !== "granted"
              && (await h.requestPermission({ mode: "readwrite" })) !== "granted") {
        setSaveMsg("Saving to the folder wasn't allowed — nothing reloaded"); return;
      }
      setSaveMsg("Saving…");
      await writeFolder(h, cfg);
      setSaveMsg("Saved to " + h.name + "/" + FILE_NAME + " — reloading…");
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      if (!isAbort(e)) setSaveMsg("Save failed, page not reloaded: " + errMsg(e));
    }
  };

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

  // ---------- edit helpers ----------
  const addButton = (secId: string) => {
    const b = btn({});
    update(d => { const s = d.sections.find(x => x.id === secId)!; b.pageId = s.activePage; s.items.push(b); });
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
  const setPageField = <K extends "outputName" | "channel">(secId: string, pageId: string, key: K, val: Page[K]) => update(d => {
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
        <select value={config.settings.channel} onChange={e => setS("channel", +e.target.value)} title="Global channel">
          {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>Ch {i + 1}</option>)}
        </select>
        <input className="narrow" type="number" min="1" max="127" value={config.settings.velocity} title="Default velocity"
          onChange={e => setS("velocity", clamp(+e.target.value || 1, 1, 127))} />
        <div className="lcd">
          <span>{last}</span>
          {gpName && <span className="pad-ico" title={gpName}>🎮</span>}
        </div>
        <button className={"tb" + (edit ? " on" : "")} onClick={() => { setEdit(!edit); setSel(null); }}>{edit ? "Done" : "Edit"}</button>
        <button className="tb" onClick={toggleFull}>{isFull ? "Exit full" : "Fullscreen"}</button>
        <button className="tb danger" onClick={panic}>Panic</button>
      </header>

      {edit ? (
        <div className="tools">
          <button className="tb primary" onClick={saveAndReload} title="Write reaper-midi-layout.json, then reload">Save &amp; reload</button>
          <button className="tb" onClick={addSection}>Add section</button>
          <button className="tb" onClick={() => addFader("knob")}>Add knob</button>
          <button className="tb" onClick={() => addFader("fader")}>Add fader</button>
          {folderState === "none" && <button className="tb" onClick={linkFolder}>Link save folder</button>}
          {folderState === "prompt" && <button className="tb on" onClick={reconnect}>Reconnect {folder && folder.name}</button>}
          {folderState === "connected" && <><button className="tb" onClick={save}>Save now</button><button className="tb" onClick={unlink}>Unlink folder</button></>}
          <button className="tb" onClick={exportJson}>Export</button>
          <button className="tb" onClick={() => importRef.current?.click()}>Import</button>
          <button className="tb" onClick={() => { if (confirm("Reset to the default layout?")) { setConfig(makeDefault()); setSel(null); } }}>Reset</button>
          <span className="chip">{saveMsg}</span>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importJson} />
        </div>
      ) : folderState === "prompt" ? (
        <div className="tools"><button className="tb primary" onClick={reconnect}>Reconnect save folder “{folder && folder.name}”</button>
          <span className="chip">The browser needs one click to allow saving again.</span></div>
      ) : <div></div>}

      <main className="deck">
        {config.sections.map(s => {
          const pageItems = itemsOnPage(s);
          const rows = s.rows || Math.max(1, Math.ceil(pageItems.length / s.cols));
          return (
            <div className="section" key={s.id} style={{ flex: `${rows} 1 0` }}>
              <div className="lane">
                <span className="tag">{s.title}</span>
                {s.pages && s.pages.length > 1 && s.pages.map(p => (
                  <button key={p.id} className={"tb" + (s.activePage === p.id ? " on" : "")} onClick={() => setPage(s.id, p.id)}>{p.title}</button>
                ))}
                {edit && <>
                  <button className={"tb" + (sel?.id === s.id ? " on" : "")} onClick={() => setSel({ kind: "section", id: s.id })}>Edit section</button>
                  <button className="tb" onClick={() => addButton(s.id)}>Add button</button>
                </>}
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${s.cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                {pageItems.map(b => {
                  const eff = effItem(s, b);
                  return (
                    <PadButton key={b.id} b={b} lit={!!activeRef.current[b.id]} edit={edit}
                      selected={sel?.id === b.id}
                      onSelect={() => setSel({ kind: "button", id: b.id })}
                      onPress={() => press(eff)} onRelease={() => release(eff)} />
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
        addPage={addPage} addHelixTab={addHelixTab} renamePage={renamePage} setPageField={setPageField} deletePage={deletePage} />}
      {edit && !sel && (
        <div className="drawer">
          <h3>Edit mode</h3>
          <label className="field">Layout name<input type="text" value={config.settings.name || ""} placeholder="REAPER Control"
            onChange={e => setS("name", e.target.value)} /></label>
          <p className="help">Tap any block, knob or “Edit section” to change it. Changes save automatically
            {folderState === "connected" && folder
              ? <> to <b>{folder.name}/{FILE_NAME}</b>.</>
              : <> in this browser. Use “Link save folder” and pick the folder this HTML file is in to keep the layout as a file next to it.</>}
          </p>
          <p className="help">Save &amp; reload writes the file and restarts the controller from it. Ctrl+S saves without reloading.</p>
          <p className="help">Gamepad bindings work when the GPD Win 4 is in gamepad mode. Press any controller button once so the browser detects it.</p>
        </div>
      )}
    </div>
  );
}
