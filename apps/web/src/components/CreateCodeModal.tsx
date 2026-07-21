import { useRef, useState, type FormEvent } from "react";
import { ImageUp, Link2, LoaderCircle, X } from "lucide-react";
import { api } from "../api";
import type { RelayCode } from "../types";

interface Props {
  onClose: () => void;
  onCreated: (code: RelayCode) => void;
}

export function CreateCodeModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const decode = async (file: File) => {
    setDecoding(true);
    setError("");
    const objectUrl = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(objectUrl);
      setTarget(result.getText());
    } catch {
      setError("没有在图片中识别到二维码，请换一张更清晰的图片");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setDecoding(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api<{ code: RelayCode }>("/api/codes", { method: "POST", body: JSON.stringify({ name, target }) });
      onCreated(result.code);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <header className="modal-header"><div><h2>创建活码</h2><p>短码会自动生成且永不复用</p></div><button type="button" className="icon-button" onClick={onClose}><X size={20} /></button></header>
        <div className="modal-body">
          <label className="field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：用户交流群" autoFocus required /></label>
          <label className="field"><span>当前目标</span><div className="input-with-icon"><Link2 size={17} /><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://… 或 weixin://…" required /></div></label>
          <div className="upload-target">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => event.target.files?.[0] && decode(event.target.files[0])} />
            <button className="button ghost" type="button" onClick={() => fileRef.current?.click()} disabled={decoding}>{decoding ? <LoaderCircle className="spin" size={17} /> : <ImageUp size={17} />}从二维码图片识别目标</button>
            <span>图片仅在浏览器本地解析</span>
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
        <footer className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || decoding}>{saving ? "创建中…" : "创建活码"}</button></footer>
      </form>
    </div>
  );
}
