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
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [pendingCode, setPendingCode] = useState<RelayCode | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const decode = async (file: File) => {
    if (file.size > 8_000_000) {
      setError("二维码图片不能超过 8 MB");
      return;
    }
    setDecoding(true);
    setError("");
    try {
      const { decodeQrImage } = await import("../qrDecoder");
      setTarget(await decodeQrImage(file));
      setSourceFile(file);
    } catch {
      setError("没有在图片中识别到二维码，请换一张更清晰的图片");
    } finally {
      setDecoding(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    let code = pendingCode;
    try {
      if (!code) {
        const result = await api<{ code: RelayCode }>("/api/codes", { method: "POST", body: JSON.stringify({ name, target }) });
        code = result.code;
        setPendingCode(code);
      }
      if (sourceFile && !code.hasSourceQr) {
        const form = new FormData(); form.append("sourceQr", sourceFile);
        code = (await api<{ code: RelayCode }>(`/api/codes/${code.id}/source-qr?target=${encodeURIComponent(target)}`, { method: "POST", body: form })).code;
        setPendingCode(code);
      }
      if (useFallback && !code.fallbackEnabled) {
        code = (await api<{ code: RelayCode }>(`/api/codes/${code.id}/fallback-state`, { method: "PUT", body: JSON.stringify({ enabled: true }) })).code;
        setPendingCode(code);
      }
      onCreated(code);
    } catch (caught) {
      setError(`${code ? "活码已创建，但图片或 Fallback 设置失败" : "创建失败"}：${(caught as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const close = () => pendingCode ? onCreated(pendingCode) : onClose();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <form className="modal" onSubmit={submit}>
        <header className="modal-header"><div><h2>创建活码</h2><p>短码会自动生成且永不复用</p></div><button type="button" className="icon-button" onClick={close}><X size={20} /></button></header>
        <div className="modal-body">
          <label className="field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：用户交流群" autoFocus required disabled={Boolean(pendingCode)} /></label>
          <label className="field"><span>当前目标</span><div className="input-with-icon"><Link2 size={17} /><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://… 或 weixin://…" required disabled={Boolean(pendingCode)} /></div></label>
          <div className="upload-target">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => event.target.files?.[0] && decode(event.target.files[0])} />
            <button className="button ghost" type="button" onClick={() => fileRef.current?.click()} disabled={decoding}>{decoding ? <LoaderCircle className="spin" size={17} /> : <ImageUp size={17} />}上传并识别二维码</button>
            <span>{sourceFile ? "链接已识别，原图将在创建时保存" : "图片先在浏览器本地识别"}</span>
          </div>
          {sourceFile && <div className="fallback-option"><div><strong>启用 Fallback 方案</strong><small>扫码者可自行选择打开链接或长按识别原图</small></div><label className="switch"><input type="checkbox" checked={useFallback} onChange={(event) => setUseFallback(event.target.checked)} /><span /></label></div>}
          {error && <div className="form-error">{error}</div>}
        </div>
        <footer className="modal-footer"><button type="button" className="button secondary" onClick={close}>{pendingCode ? "稍后设置" : "取消"}</button><button className="button primary" disabled={saving || decoding}>{saving ? "处理中…" : pendingCode ? "重试并完成" : "创建活码"}</button></footer>
      </form>
    </div>
  );
}
