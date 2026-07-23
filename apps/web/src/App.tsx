import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, ChevronRight, CirclePause, KeyRound, LayoutDashboard, LogOut, Menu, Plus, QrCode, Search, ShieldCheck, X } from "lucide-react";
import { api, ApiError } from "./api";
import type { RelayCode, User } from "./types";
import { AuthScreen } from "./components/AuthScreen";
import { AdminPage } from "./components/AdminPage";
import { CodeDetail } from "./components/CodeDetail";
import { CreateCodeModal } from "./components/CreateCodeModal";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [codes, setCodes] = useState<RelayCode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"dashboard" | "admin">("dashboard");

  const loadCodes = async () => {
    const result = await api<{ codes: RelayCode[] }>("/api/codes");
    setCodes(result.codes);
  };

  useEffect(() => {
    api<{ user: User }>("/api/auth/me")
      .then(async (result) => { setUser(result.user); await loadCodes(); })
      .catch((error) => { if (!(error instanceof ApiError) || error.status !== 401) console.error(error); })
      .finally(() => setLoading(false));
  }, []);

  const selected = codes.find((code) => code.id === selectedId) ?? null;
  const filtered = useMemo(() => codes.filter((code) => `${code.name} ${code.slug} ${code.target}`.toLowerCase().includes(search.toLowerCase())), [codes, search]);

  const updateCode = (updated: RelayCode) => setCodes((current) => [updated, ...current.filter((code) => code.id !== updated.id)]);
  const deleteCode = (id: string) => { setCodes((current) => current.filter((code) => code.id !== id)); setSelectedId(null); };
  const select = (id: string | null) => { setSelectedId(id); setView("dashboard"); setSidebarOpen(false); };
  const authenticated = async (newUser: User) => { setUser(newUser); setView("dashboard"); await loadCodes(); };
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); setUser(null); setCodes([]); setSelectedId(null); setView("dashboard"); };
  const openAdmin = () => { setView("admin"); setSidebarOpen(false); };
  const updateCurrentUserRole = (isAdmin: boolean) => {
    setUser((current) => current ? { ...current, isAdmin } : current);
    if (!isAdmin) setView("dashboard");
  };

  if (loading) return <div className="app-loading"><span className="brand-mark"><QrCode size={24} /></span><strong>RelayQR</strong></div>;
  if (!user) return <AuthScreen onAuthenticated={authenticated} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand"><span className="brand-mark"><QrCode size={20} /></span>RelayQR</div>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <button className={`nav-home ${view === "dashboard" && selectedId === null ? "active" : ""}`} onClick={() => select(null)}><LayoutDashboard size={18} />总览</button>
        {user.isAdmin && <button className={`nav-home ${view === "admin" ? "active" : ""}`} onClick={openAdmin}><ShieldCheck size={18} />管理员中心</button>}
        <div className="sidebar-section">
          <div className="section-label"><span>我的活码</span><button onClick={() => setCreateOpen(true)} title="新建活码"><Plus size={16} /></button></div>
          <div className="sidebar-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索" /></div>
          <div className="code-nav-list">
            {filtered.map((code) => <button key={code.id} className={selectedId === code.id ? "active" : ""} onClick={() => select(code.id)}><span className="tiny-qr"><QrCode size={15} /></span><span><strong>{code.name}</strong><small>{code.redirectEnabled ? code.slug : "已暂停"}</small></span>{!code.redirectEnabled && <CirclePause className="pause-icon" size={14} />}</button>)}
            {!filtered.length && <p className="sidebar-empty">{codes.length ? "没有匹配结果" : "还没有活码"}</p>}
          </div>
        </div>
        <div className="user-area">
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div><strong>{user.username}</strong><small>{user.isAdmin ? "管理员" : "本地账号"}</small></div>
          <button title="修改密码" onClick={() => setPasswordOpen(true)}><KeyRound size={16} /></button>
          <button title="退出登录" onClick={logout}><LogOut size={16} /></button>
        </div>
      </aside>
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="main-content">
        <header className="mobile-header"><button onClick={() => setSidebarOpen(true)}><Menu size={22} /></button><div className="brand"><span className="brand-mark"><QrCode size={18} /></span>RelayQR</div><button className="mobile-add" onClick={() => setCreateOpen(true)}><Plus size={20} /></button></header>
        {view === "admin" && user.isAdmin ? <AdminPage currentUser={user} onCurrentUserRoleChange={updateCurrentUserRole} /> : selected ? <CodeDetail code={selected} onUpdate={updateCode} onDelete={deleteCode} /> : <HomeDashboard codes={codes} onSelect={(id) => select(id)} onCreate={() => setCreateOpen(true)} />}
      </main>

      {createOpen && <CreateCodeModal onClose={() => setCreateOpen(false)} onCreated={(code) => { setCodes((current) => [code, ...current]); setSelectedId(code.id); setView("dashboard"); setCreateOpen(false); }} />}
      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}

function HomeDashboard({ codes, onSelect, onCreate }: { codes: RelayCode[]; onSelect: (id: string) => void; onCreate: () => void }) {
  const active = codes.filter((code) => code.redirectEnabled).length;
  return <section className="home-page">
    <header className="home-header"><div><span className="eyebrow">控制台</span><h1>你的动态二维码</h1><p>固定入口，目标始终由你掌控。</p></div><button className="button primary" onClick={onCreate}><Plus size={17} />创建活码</button></header>
    <div className="summary-grid"><article><span className="summary-icon indigo"><QrCode size={19} /></span><div><small>全部活码</small><strong>{codes.length}</strong></div></article><article><span className="summary-icon green"><Activity size={19} /></span><div><small>正在跳转</small><strong>{active}</strong></div></article><article><span className="summary-icon amber"><CirclePause size={19} /></span><div><small>已暂停</small><strong>{codes.length - active}</strong></div></article></div>
    <div className="home-list-heading"><div><h2>最近更新</h2><p>管理目标、暂停状态与二维码样式</p></div></div>
    {codes.length ? <div className="code-card-grid">{codes.map((code) => <button className="code-card" key={code.id} onClick={() => onSelect(code.id)}><div className="card-top"><span className="code-visual"><QrCode size={32} /></span><span className={`status-dot ${code.redirectEnabled ? "active" : "paused"}`}><i />{code.redirectEnabled ? "跳转中" : "已暂停"}</span></div><div className="card-copy"><h3>{code.name}</h3><p>{code.redirectEnabled ? code.target : code.disabledReason}</p></div><footer><code>/r/{code.slug}</code><span>{new Date(code.updatedAt).toLocaleDateString("zh-CN")}<ChevronRight size={15} /></span></footer></button>)}</div> : <div className="empty-state"><span><QrCode size={32} /></span><h2>创建第一个活码</h2><p>生成固定二维码，以后只需在后台切换目标。</p><button className="button primary" onClick={onCreate}><Plus size={17} />开始创建</button></div>}
  </section>;
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try { await api("/api/auth/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) }); onClose(); }
    catch (caught) { setError((caught as Error).message); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop"><form className="modal compact" onSubmit={submit}><header className="modal-header"><div><h2>修改密码</h2><p>其他设备上的登录会被退出</p></div><button type="button" className="icon-button" onClick={onClose}><X size={20} /></button></header><div className="modal-body"><label className="field"><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoFocus /></label><label className="field"><span>新密码</span><input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>{error && <div className="form-error">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer></form></div>;
}
