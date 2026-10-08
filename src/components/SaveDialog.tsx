import { useEffect, useRef, useState } from "react";

type Props = {
  name: string;
  onSave: (name: string, reload: boolean) => void;
  onClose: () => void;
};

export function SaveDialog({ name, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [n, setN] = useState(name);
  useEffect(() => { ref.current?.showModal(); }, []);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <form method="dialog" onSubmit={e => { e.preventDefault(); onSave(n, false); }}>
        <h3>Save layout</h3>
        <label className="field">Layout name<input type="text" autoFocus value={n} placeholder="REAPER Control"
          onChange={e => setN(e.target.value)} /></label>
        <p className="help">The layout is saved in this browser. Use Export to keep a backup file.</p>
        <div className="actions">
          <button type="button" className="tb" onClick={onClose}>Cancel</button>
          <button type="button" className="tb" onClick={() => onSave(n, true)}>Save &amp; reload</button>
          <button type="submit" className="tb primary">Save</button>
        </div>
      </form>
    </dialog>
  );
}
