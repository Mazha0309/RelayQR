import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AlertTriangle, BarChart3, Check, CirclePause, Clock3, Copy, ExternalLink, FileImage, History, ImagePlus, Link2, MapPin, Palette, Play, Plus, Save, Settings2, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { api } from "../api";
import type { GateQuestion, GateSettings, QrStyle, RelayCode, Revision, Stats } from "../types";
import { QrDesigner } from "./QrDesigner";

interface Props {
  code: RelayCode;
  onUpdate: (code: RelayCode) => void;
  onDelete: (id: string) => void;
}

type Tab = "overview" | "design" | "analytics" | "history";

export function CodeDetail({ code, onUpdate, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [target, setTarget] = useState(code.target);
  const [name, setName] = useState(code.name);
  const [style, setStyle] = useState<QrStyle>(code.style);
  const [disabledReason, setDisabledReason] = useState(code.disabledReason ?? "");
  const [gate, setGate] = useState<GateSettings>(code.gate);
  const [allowedRegionsText, setAllowedRegionsText] = useState(code.gate.allowedRegions.join("\n"));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [copied, setCopied] = useState(false);
  const targetFileRef = useRef<HTMLInputElement>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTarget(code.target);
    setName(code.name);
    setStyle(code.style);
    setDisabledReason(code.disabledReason ?? "");
    setGate(code.gate);
    setAllowedRegionsText(code.gate.allowedRegions.join("\n"));
    setError("");
    setMessage("");
  }, [code.id, code.updatedAt]);

  useEffect(() => {
    if (tab === "analytics") api<Stats>(`/api/codes/${code.id}/stats`).then(setStats).catch((caught) => setError(caught.message));
    if (tab === "history") api<{ revisions: Revision[] }>(`/api/codes/${code.id}/history`).then((result) => setRevisions(result.revisions)).catch((caught) => setError(caught.message));
  }, [tab, code.id, code.updatedAt]);

  const act = async (operation: () => Promise<RelayCode>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const updated = await operation();
      onUpdate(updated);
      setMessage(success);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveTarget = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => (await api<{ code: RelayCode }>(`/api/codes/${code.id}/target`, { method: "PUT", body: JSON.stringify({ target }) })).code, code.fallbackEnabled ? "目标已更新；为避免原图不匹配，Fallback 已自动关闭" : "目标已更新，固定二维码无需更换");
  };

  const saveName = () => void act(async () => (await api<{ code: RelayCode }>(`/api/codes/${code.id}`, { method: "PATCH", body: JSON.stringify({ name }) })).code, "名称已保存");
  const saveStyle = () => void act(async () => (await api<{ code: RelayCode }>(`/api/codes/${code.id}`, { method: "PATCH", body: JSON.stringify({ style }) })).code, "二维码样式已保存");

  const setRedirect = (enabled: boolean) => {
    void act(async () => (await api<{ code: RelayCode }>(`/api/codes/${code.id}/redirect-state`, {
      method: "PUT",
      body: JSON.stringify({ enabled, reason: enabled ? undefined : disabledReason }),
    })).code, enabled ? "跳转已恢复" : "跳转已暂停");
  };

  const decodeTarget = async (file: File) => {
    if (file.size > 8_000_000) {
      setError("二维码图片不能超过 8 MB");
      if (targetFileRef.current) targetFileRef.current.value = "";
      return;
    }
    setBusy(true); setError("");
    try {
      const { decodeQrImage } = await import("../qrDecoder");
      const decodedTarget = await decodeQrImage(file);
      const form = new FormData(); form.append("sourceQr", file);
      const result = await api<{ code: RelayCode }>(`/api/codes/${code.id}/source-qr?target=${encodeURIComponent(decodedTarget)}`, { method: "POST", body: form });
      setTarget(result.code.target);
      onUpdate(result.code);
      setMessage("目标链接和二维码原图已更新");
    } catch (caught) {
      setError((caught as Error).message || "没有在图片中识别到二维码，请换一张更清晰的原图");
    } finally {
      setBusy(false);
      if (targetFileRef.current) targetFileRef.current.value = "";
    }
  };

  const uploadIcon = async (file: File) => {
    const form = new FormData(); form.append("icon", file);
    await act(async () => (await api<{ code: RelayCode }>(`/api/codes/${code.id}/icon`, { method: "POST", body: form })).code, "中心图标已更新");
    if (iconFileRef.current) iconFileRef.current.value = "";
  };

  const removeIcon = () => void act(async () => {
    await api(`/api/codes/${code.id}/icon`, { method: "DELETE" });
    return { ...code, hasIcon: false, iconUrl: null, updatedAt: new Date().toISOString() };
  }, "中心图标已移除");

  const setFallbackState = (enabled: boolean) => void act(async () => (
    await api<{ code: RelayCode }>(`/api/codes/${code.id}/fallback-state`, {
      method: "PUT",
      body: JSON.stringify({ enabled, showTargetLink: code.showTargetLink }),
    })
  ).code, enabled ? "Fallback 二维码展示页已启用" : "Fallback 已关闭，恢复自动跳转");

  const setTargetLinkVisibility = (showTargetLink: boolean) => void act(async () => (
    await api<{ code: RelayCode }>(`/api/codes/${code.id}/fallback-state`, {
      method: "PUT",
      body: JSON.stringify({ enabled: code.fallbackEnabled, showTargetLink }),
    })
  ).code, showTargetLink ? "公开页将展示目标链接" : "公开页将只展示二维码");

  const removeSourceQr = () => void act(async () => (
    await api<{ code: RelayCode }>(`/api/codes/${code.id}/source-qr`, { method: "DELETE" })
  ).code, "二维码原图已移除，Fallback 已关闭");

  const parsedRegions = () => [...new Set(allowedRegionsText.split(/[\n,，、]/).map((region) => region.trim()).filter(Boolean))];

  const saveGate = () => void act(async () => (
    await api<{ code: RelayCode }>(`/api/codes/${code.id}/gate`, {
      method: "PUT",
      body: JSON.stringify({ ...gate, allowedRegions: parsedRegions() }),
    })
  ).code, gate.enabled ? "访问条件已启用" : "访问条件已保存并关闭");

  const updateQuestion = (id: string, update: (question: GateQuestion) => GateQuestion) => {
    setGate((current) => ({ ...current, questions: current.questions.map((question) => question.id === id ? update(question) : question) }));
  };

  const addQuestion = (type: GateQuestion["type"]) => {
    const id = crypto.randomUUID().replaceAll("-", "");
    const question: GateQuestion = type === "choice"
      ? { id, type, prompt: "", options: ["", ""], correctOption: 0 }
      : { id, type, prompt: "", correctAnswer: "" };
    setGate((current) => ({ ...current, questions: [...current.questions, question] }));
  };

  const removeQuestion = (id: string) => setGate((current) => ({ ...current, questions: current.questions.filter((question) => question.id !== id) }));

  const gatePayload = { ...gate, allowedRegions: parsedRegions() };
  const gateDirty = JSON.stringify(gatePayload) !== JSON.stringify(code.gate);

  const restore = (revision: Revision) => {
    if (!window.confirm(`恢复到目标“${revision.target}”？这会创建一个新的历史版本。`)) return;
    void act(async () => (await api<{ code: RelayCode }>(`/api/codes/${code.id}/history/${revision.id}/restore`, { method: "POST" })).code, "历史目标已恢复");
  };

  const deleteCode = async () => {
    if (!window.confirm("确定永久停用这个活码吗？旧二维码将返回“已删除”，短码也不会再次使用。")) return;
    try {
      await api(`/api/codes/${code.id}`, { method: "DELETE" });
      onDelete(code.id);
    } catch (caught) { setError((caught as Error).message); }
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(code.publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const patchStyle = <K extends keyof QrStyle>(key: K, value: QrStyle[K]) => setStyle((current) => ({ ...current, [key]: value }));

  return (
    <section className="detail-page">
      <header className="detail-header">
        <div className="title-block">
          <div className="title-line"><input className="title-input" value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name !== code.name && saveName()} /><span className={`status-pill ${code.redirectEnabled ? "enabled" : "paused"}`}>{code.redirectEnabled ? <><Check size={13} />跳转中</> : <><CirclePause size={13} />已暂停</>}</span></div>
          <div className="public-link"><span>{code.publicUrl}</span><button onClick={copyUrl} title="复制链接">{copied ? <Check size={15} /> : <Copy size={15} />}</button><a href={code.publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a></div>
        </div>
        <button className="button danger-subtle" onClick={deleteCode}><Trash2 size={16} />删除</button>
      </header>

      <nav className="tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Settings2 size={16} />概览</button>
        <button className={tab === "design" ? "active" : ""} onClick={() => setTab("design")}><Palette size={16} />样式与下载</button>
        <button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}><BarChart3 size={16} />扫描统计</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={16} />目标历史</button>
      </nav>

      {(error || message) && <div className={`notice ${error ? "error" : "success"}`}>{error || message}<button onClick={() => { setError(""); setMessage(""); }}><X size={15} /></button></div>}

      {tab === "overview" && <div className="content-grid overview-grid">
        <div className="stack">
          <article className="panel">
            <div className="panel-heading"><div><span className="panel-icon"><Link2 size={18} /></span><div><h3>当前目标</h3><p>更新后，所有已印刷二维码立即使用新目标</p></div></div></div>
            <form onSubmit={saveTarget} className="target-form">
              <textarea value={target} onChange={(event) => setTarget(event.target.value)} rows={3} placeholder="https://… 或自定义应用协议" />
              <div className="form-actions">
                <input ref={targetFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => event.target.files?.[0] && decodeTarget(event.target.files[0])} />
                <button type="button" className="button ghost" disabled={busy} onClick={() => targetFileRef.current?.click()}><Upload size={16} />上传并识别二维码</button>
                <button className="button primary" disabled={busy || target === code.target}><Save size={16} />保存目标</button>
              </div>
            </form>
          </article>

          <article className="panel fallback-control">
            <div className="panel-heading">
              <div><span className="panel-icon"><FileImage size={18} /></span><div><h3>Fallback 方案</h3><p>使用上方上传的二维码原图，提供通用的备用访问方式</p></div></div>
              <label className="switch" title={code.hasSourceQr ? "启用 Fallback 二维码展示页" : "请先上传并识别二维码图片"}><input type="checkbox" checked={code.fallbackEnabled} disabled={busy || !code.hasSourceQr} onChange={(event) => setFallbackState(event.target.checked)} /><span /></label>
            </div>
            {code.hasSourceQr && code.sourceQrUrl ? <div className="fallback-admin">
              <img src={code.sourceQrUrl} alt="当前上传的二维码原图" />
              <div><strong>{code.fallbackEnabled ? "二维码展示页已启用" : "原图已保存，Fallback 未启用"}</strong><p>{code.fallbackEnabled ? (code.showTargetLink ? "访问者会看到目标链接和原图二维码。" : "访问者只会看到原图二维码，不展示目标链接。") : "扫码仍会直接跳转到当前目标。"}</p><div className="icon-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => targetFileRef.current?.click()}><Upload size={16} />上传新二维码</button><button type="button" className="button ghost danger-text" disabled={busy} onClick={removeSourceQr}>移除原图</button></div></div>
            </div> : <div className="fallback-empty"><p>还没有二维码原图。请点击上方“上传并识别二维码”，系统会在更新链接时自动保存原图。</p></div>}
            <div className="fallback-option"><div><strong>展示目标链接</strong><small>关闭后公开页只展示二维码图片，不输出目标链接</small></div><label className="switch"><input type="checkbox" checked={code.showTargetLink} disabled={busy} onChange={(event) => setTargetLinkVisibility(event.target.checked)} /><span /></label></div>
            <p className="hint">Fallback 关闭时直接跳转；开启后按照上方设置展示二维码，目标链接可独立隐藏。</p>
          </article>

          <article className="panel gate-control">
            <div className="panel-heading">
              <div><span className="panel-icon"><ShieldCheck size={18} /></span><div><h3>访问条件</h3><p>按 IP 属地和答题结果决定是否显示目标内容</p></div></div>
              <label className="switch" title={code.fallbackEnabled ? "启用访问条件" : "请先启用 Fallback"}><input type="checkbox" checked={gate.enabled} disabled={busy || !code.fallbackEnabled} onChange={(event) => setGate((current) => ({ ...current, enabled: event.target.checked }))} /><span /></label>
            </div>

            {!code.fallbackEnabled && <div className="gate-prerequisite">请先上传二维码原图并启用 Fallback，访问条件才能保护目标内容和二维码图片。</div>}

            <section className="gate-section">
              <div className="gate-section-title"><div><MapPin size={16} /><strong>IP 属地筛选</strong></div><label className="switch"><input type="checkbox" checked={gate.locationEnabled} onChange={(event) => setGate((current) => ({ ...current, locationEnabled: event.target.checked }))} /><span /></label></div>
              {gate.locationEnabled && <label className="field"><span>允许的属地</span><textarea rows={3} value={allowedRegionsText} onChange={(event) => setAllowedRegionsText(event.target.value)} placeholder={"浙江省\n杭州市"} /><small>一行一个，也可用逗号或顿号分隔；国家、省或城市任一匹配即可。</small></label>}
            </section>

            <section className="gate-section">
              <div className="gate-section-title"><div><ShieldCheck size={16} /><strong>验证题目</strong><small>{gate.questions.length}/10</small></div><div className="question-add"><button type="button" className="button ghost compact" disabled={gate.questions.length >= 10} onClick={() => addQuestion("choice")}><Plus size={14} />单选题</button><button type="button" className="button ghost compact" disabled={gate.questions.length >= 10} onClick={() => addQuestion("text")}><Plus size={14} />填空题</button></div></div>
              {gate.questions.length === 0 ? <div className="gate-empty">还没有题目。可仅使用属地筛选，也可以添加多道单选题和填空题。</div> : <div className="question-list">{gate.questions.map((question, questionIndex) => <div className="question-editor" key={question.id}>
                <div className="question-editor-head"><strong>第 {questionIndex + 1} 题</strong><select value={question.type} onChange={(event) => updateQuestion(question.id, (current) => event.target.value === "choice"
                  ? { id: current.id, prompt: current.prompt, type: "choice", options: ["", ""], correctOption: 0 }
                  : { id: current.id, prompt: current.prompt, type: "text", correctAnswer: "" })}><option value="choice">单选题</option><option value="text">填空题</option></select><button type="button" className="icon-button danger-text" title="删除题目" onClick={() => removeQuestion(question.id)}><Trash2 size={15} /></button></div>
                <input value={question.prompt} maxLength={200} onChange={(event) => updateQuestion(question.id, (current) => ({ ...current, prompt: event.target.value }))} placeholder="输入题目" />
                {question.type === "choice" ? <div className="choice-editor">{question.options.map((option, optionIndex) => <div className="choice-row" key={`${question.id}-${optionIndex}`}><input type="radio" name={`correct-${question.id}`} checked={question.correctOption === optionIndex} onChange={() => updateQuestion(question.id, (current) => current.type === "choice" ? ({ ...current, correctOption: optionIndex }) : current)} title="设为正确答案" /><input value={option} maxLength={100} onChange={(event) => updateQuestion(question.id, (current) => current.type === "choice" ? ({ ...current, options: current.options.map((item, index) => index === optionIndex ? event.target.value : item) }) : current)} placeholder={`选项 ${optionIndex + 1}`} />{question.options.length > 2 && <button type="button" className="icon-button danger-text" title="删除选项" onClick={() => updateQuestion(question.id, (current) => {
                    if (current.type !== "choice") return current;
                    const options = current.options.filter((_, index) => index !== optionIndex);
                    const correctOption = current.correctOption === optionIndex ? 0 : current.correctOption > optionIndex ? current.correctOption - 1 : current.correctOption;
                    return { ...current, options, correctOption };
                  })}><X size={14} /></button>}</div>)}<button type="button" className="button ghost compact add-option" disabled={question.options.length >= 8} onClick={() => updateQuestion(question.id, (current) => current.type === "choice" ? ({ ...current, options: [...current.options, ""] }) : current)}><Plus size={14} />添加选项</button><small>点击选项左侧圆点设置正确答案。</small></div> : <label className="field"><span>标准答案</span><input value={question.correctAnswer} maxLength={200} onChange={(event) => updateQuestion(question.id, (current) => current.type === "text" ? ({ ...current, correctAnswer: event.target.value }) : current)} placeholder="输入唯一正确答案" /><small>校验时忽略首尾空格和英文大小写，不做模糊匹配。</small></label>}
              </div>)}</div>}
            </section>

            <div className="gate-save"><p>开启后，访客必须满足属地要求并答对全部题目；失败时不会返回目标内容或二维码图片。</p><button type="button" className="button primary" disabled={busy || !gateDirty || (gate.enabled && !code.fallbackEnabled)} onClick={saveGate}><Save size={16} />保存访问条件</button></div>
          </article>

          <article className={`panel redirect-control ${code.redirectEnabled ? "" : "is-paused"}`}>
            <div className="panel-heading"><div><span className="panel-icon"><Play size={18} /></span><div><h3>跳转控制</h3><p>单独暂停这个二维码，并向扫码者说明原因</p></div></div></div>
            {code.redirectEnabled ? <div className="pause-form">
              <label className="field"><span>暂停说明</span><textarea value={disabledReason} onChange={(event) => setDisabledReason(event.target.value)} rows={3} placeholder="例如：活动已结束，新的入口将在稍后开放" /></label>
              <button className="button warning" disabled={busy || !disabledReason.trim()} onClick={() => setRedirect(false)}><CirclePause size={16} />暂停跳转</button>
            </div> : <div className="paused-state">
              <div><AlertTriangle size={20} /><span><strong>当前向扫码者显示：</strong>{code.disabledReason}</span></div>
              <button className="button primary" disabled={busy} onClick={() => setRedirect(true)}><Play size={16} />恢复跳转</button>
            </div>}
          </article>
        </div>
        <aside className="panel qr-mini"><QrDesigner value={code.publicUrl} style={code.style} iconUrl={code.iconUrl} /><div className="mini-meta"><span>短码</span><code>{code.slug}</code></div></aside>
      </div>}

      {tab === "design" && <div className="design-layout">
        <article className="panel design-controls">
          <div className="panel-heading"><div><span className="panel-icon"><Palette size={18} /></span><div><h3>二维码样式</h3><p>预览会随设置即时更新</p></div></div></div>
          <div className="control-section"><h4>背景</h4><div className="option-row"><label className="radio"><input type="radio" checked={style.backgroundMode === "solid"} onChange={() => patchStyle("backgroundMode", "solid")} />纯色</label><label className="radio"><input type="radio" checked={style.backgroundMode === "transparent"} onChange={() => patchStyle("backgroundMode", "transparent")} />透明</label>{style.backgroundMode === "solid" && <input type="color" value={style.backgroundColor} onChange={(event) => patchStyle("backgroundColor", event.target.value)} />}</div></div>
          <div className="control-section"><div className="section-title"><h4>文字</h4><label className="switch"><input type="checkbox" checked={style.textEnabled} onChange={(event) => patchStyle("textEnabled", event.target.checked)} /><span /></label></div>{style.textEnabled && <div className="control-stack"><input value={style.text} maxLength={120} onChange={(event) => patchStyle("text", event.target.value)} placeholder="输入展示文字" /><div className="three-controls"><select value={style.textPosition} onChange={(event) => patchStyle("textPosition", event.target.value as QrStyle["textPosition"])}><option value="top">顶部</option><option value="bottom">底部</option></select><select value={style.textWeight} onChange={(event) => patchStyle("textWeight", event.target.value as QrStyle["textWeight"])}><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select><input type="color" value={style.textColor} onChange={(event) => patchStyle("textColor", event.target.value)} /></div><label className="range-label"><span>字号 <strong>{style.textSize}px</strong></span><input type="range" min="14" max="72" value={style.textSize} onChange={(event) => patchStyle("textSize", Number(event.target.value))} /></label></div>}</div>
          <div className="control-section"><h4>中心图标</h4><input ref={iconFileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => event.target.files?.[0] && uploadIcon(event.target.files[0])} /><div className="icon-actions"><button className="button secondary" onClick={() => iconFileRef.current?.click()}><ImagePlus size={16} />{code.hasIcon ? "更换图标" : "上传图标"}</button>{code.hasIcon && <button className="button ghost danger-text" onClick={removeIcon}>移除</button>}</div>{code.hasIcon && <label className="range-label"><span>图标大小 <strong>{style.iconSize}%</strong></span><input type="range" min="10" max="28" value={style.iconSize} onChange={(event) => patchStyle("iconSize", Number(event.target.value))} /></label>}<p className="hint">支持 PNG、JPEG、WebP，最大 1.5 MB</p></div>
          <button className="button primary wide" disabled={busy || JSON.stringify(style) === JSON.stringify(code.style)} onClick={saveStyle}><Save size={16} />保存样式</button>
        </article>
        <aside className="panel design-preview"><QrDesigner value={code.publicUrl} style={style} iconUrl={code.iconUrl} /></aside>
      </div>}

      {tab === "analytics" && <Analytics stats={stats} />}
      {tab === "history" && <HistoryPanel revisions={revisions} onRestore={restore} />}
    </section>
  );
}

function Analytics({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="empty-panel">正在加载统计…</div>;
  const max = Math.max(1, ...stats.daily.map((item) => item.count));
  return <div className="analytics-layout">
    <article className="metric-card"><span>累计扫描</span><strong>{stats.total.toLocaleString()}</strong><small>所有时间</small></article>
    <article className="panel chart-panel"><div className="panel-heading"><div><span className="panel-icon"><BarChart3 size={18} /></span><div><h3>最近 {stats.days} 天</h3><p>按 UTC 日期统计扫码次数</p></div></div></div>{stats.daily.length ? <div className="bar-chart">{stats.daily.map((item) => <div className="bar-item" key={item.date} title={`${item.date}: ${item.count}`}><span style={{ height: `${Math.max(5, item.count / max * 100)}%` }} /><small>{item.date.slice(5)}</small></div>)}</div> : <EmptyStat />}</article>
    <article className="panel breakdown"><h3>设备</h3>{stats.devices.length ? stats.devices.map((item) => <Breakdown key={item.label} {...item} total={stats.devices.reduce((sum, row) => sum + row.count, 0)} />) : <EmptyStat />}</article>
    <article className="panel breakdown"><h3>来源</h3>{stats.referrers.length ? stats.referrers.map((item) => <Breakdown key={item.label} {...item} total={stats.referrers.reduce((sum, row) => sum + row.count, 0)} />) : <EmptyStat />}</article>
    <article className="panel breakdown regions"><h3>IP 属地</h3>{stats.regions.length ? stats.regions.map((item) => <Breakdown key={item.label} {...item} total={stats.regions.reduce((sum, row) => sum + row.count, 0)} />) : <EmptyStat />}</article>
    <article className="panel scan-log"><div className="panel-heading"><div><span className="panel-icon"><MapPin size={18} /></span><div><h3>最近访问记录</h3><p>显示最近 100 次扫描；IP 地址属于个人信息，请妥善保管</p></div></div></div>{stats.recentScans.length ? <div className="scan-table-wrap"><table><thead><tr><th>时间</th><th>IP 地址</th><th>IP 属地</th><th>设备</th><th>来源</th></tr></thead><tbody>{stats.recentScans.map((scan, index) => <tr key={`${scan.scannedAt}-${scan.ipAddress}-${index}`}><td>{new Date(scan.scannedAt).toLocaleString("zh-CN")}</td><td><code>{scan.ipAddress}</code></td><td>{scan.region}</td><td>{scan.device}</td><td>{scan.referrer}</td></tr>)}</tbody></table></div> : <EmptyStat />}</article>
  </div>;
}

function Breakdown({ label, count, total }: { label: string; count: number; total: number }) {
  return <div className="breakdown-row"><div><span>{label}</span><strong>{count}</strong></div><div className="progress"><span style={{ width: `${count / Math.max(1, total) * 100}%` }} /></div></div>;
}

function EmptyStat() { return <div className="stat-empty"><BarChart3 size={24} /><span>还没有扫描数据</span></div>; }

function HistoryPanel({ revisions, onRestore }: { revisions: Revision[]; onRestore: (revision: Revision) => void }) {
  return <article className="panel history-panel"><div className="panel-heading"><div><span className="panel-icon"><Clock3 size={18} /></span><div><h3>目标变更记录</h3><p>恢复历史目标时会保留完整变更轨迹</p></div></div></div><div className="timeline">{revisions.map((revision) => <div className={`timeline-item ${revision.isActive ? "active" : ""}`} key={revision.id}><span className="timeline-dot" /><div className="timeline-content"><div><code>{revision.target}</code>{revision.isActive && <span className="current-tag">当前</span>}</div><small>{new Date(revision.createdAt).toLocaleString("zh-CN")} · {revision.protocol}</small></div>{!revision.isActive && <button className="button ghost" onClick={() => onRestore(revision)}>恢复</button>}</div>)}</div></article>;
}
