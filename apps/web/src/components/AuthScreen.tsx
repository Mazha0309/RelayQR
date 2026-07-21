import { useState, type FormEvent } from "react";
import { ArrowRight, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../api";
import type { User } from "../types";

interface Props { onAuthenticated: (user: User) => void }

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ user: User }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onAuthenticated(result.user);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="brand brand-large"><span className="brand-mark"><QrCode size={24} /></span>RelayQR</div>
        <div className="story-copy">
          <span className="eyebrow">一个二维码，持续有效</span>
          <h1>让印出去的二维码，<br />永远留有余地。</h1>
          <p>固定入口，随时切换目标。无需重新印刷，也不把数据交给第三方。</p>
          <div className="feature-list">
            <div><RefreshCw size={18} /><span><strong>即时换向</strong>目标更新后立即生效</span></div>
            <div><ShieldCheck size={18} /><span><strong>自主托管</strong>账号、目标与统计都在你的服务器</span></div>
          </div>
        </div>
        <p className="story-foot">开源 · 自托管 · 无订阅</p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-heading">
            <h2>{mode === "login" ? "欢迎回来" : "创建账号"}</h2>
            <p>{mode === "login" ? "登录后管理你的所有活码" : "不需要邮箱，立即开始使用"}</p>
          </div>
          <div className="segmented">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>登录</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>注册</button>
          </div>
          <label className="field"><span>用户名</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–32 个字符" required /></label>
          <label className="field"><span>密码</span><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 个字符" required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button primary wide" disabled={loading}>{loading ? "请稍候…" : mode === "login" ? "登录" : "创建账号"}<ArrowRight size={17} /></button>
          <p className="auth-note">当前版本不提供密码找回，请妥善保存密码。</p>
        </form>
      </section>
    </main>
  );
}
