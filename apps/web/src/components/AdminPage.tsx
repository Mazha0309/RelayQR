import { useEffect, useState } from "react";
import { Activity, Clock3, Database, HardDrive, RefreshCw, Server, ShieldCheck, Users } from "lucide-react";
import { api } from "../api";
import type { User } from "../types";

interface AdminMember {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  codeCount: number;
  auditCount: number;
  lastActivityAt: string | null;
}

interface AuditEvent {
  id: number;
  actorUserId: string | null;
  actorUsername: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  ipAddress: string;
  createdAt: string;
}

interface ServerStatus {
  generatedAt: string;
  instance: {
    hostname: string;
    platform: string;
    release: string;
    nodeVersion: string;
    cpuCount: number;
    hostUptimeSeconds: number;
  };
  requests: {
    startedAt: string;
    uptimeSeconds: number;
    totalRequests: number;
    requestsPerMinute: number;
    activeRequests: number;
    errorResponses: number;
    errorRate: number;
    averageResponseMs: number;
    processCpuPercent: number;
  };
  memory: {
    processRssBytes: number;
    processHeapUsedBytes: number;
    processHeapTotalBytes: number;
    systemTotalBytes: number;
    systemFreeBytes: number;
  };
  load: {
    oneMinute: number;
    fiveMinutes: number;
    fifteenMinutes: number;
    oneMinutePercent: number;
  };
  storage: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    databaseBytes: number;
  };
  counts: {
    users: number;
    admins: number;
    codes: number;
    activeCodes: number;
    scans: number;
    scans24h: number;
    activeSessions: number;
    auditEvents: number;
  };
}

interface Props {
  currentUser: User;
  onCurrentUserRoleChange: (isAdmin: boolean) => void;
}

type AdminTab = "server" | "members";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  return [days ? `${days}天` : "", hours ? `${hours}小时` : "", `${minutes}分钟`].filter(Boolean).join(" ");
}

function percent(value: number, total: number) {
  return Math.min(100, Math.max(0, total ? value / total * 100 : 0));
}

export function AdminPage({ currentUser, onCurrentUserRoleChange }: Props) {
  const [tab, setTab] = useState<AdminTab>("server");
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [memberFilter, setMemberFilter] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadMembers = async () => {
    const result = await api<{ users: AdminMember[] }>("/api/admin/users");
    setMembers(result.users);
  };

  const loadAudit = async (userId = memberFilter, offset = 0) => {
    setAuditLoading(true);
    try {
      const query = new URLSearchParams({ limit: "100", offset: String(offset) });
      if (userId) query.set("userId", userId);
      const result = await api<{ events: AuditEvent[] }>(`/api/admin/audit?${query}`);
      setEvents((current) => offset ? [...current, ...result.events] : result.events);
      setAuditHasMore(result.events.length === 100);
    } finally {
      setAuditLoading(false);
    }
  };

  const loadServer = async () => {
    const result = await api<ServerStatus>("/api/admin/server");
    setServer(result);
  };

  const loadSettings = async () => {
    const result = await api<{ registrationEnabled: boolean }>("/api/admin/settings");
    setRegistrationEnabled(result.registrationEnabled);
  };

  const refreshAll = async () => {
    setRefreshing(true);
    setError("");
    try {
      await Promise.all([loadMembers(), loadAudit(), loadServer(), loadSettings()]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { void refreshAll(); }, []);

  useEffect(() => {
    if (tab !== "server") return;
    const timer = window.setInterval(() => {
      loadServer().catch((caught) => setError((caught as Error).message));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  useEffect(() => {
    loadAudit(memberFilter).catch((caught) => setError((caught as Error).message));
  }, [memberFilter]);

  const changeRole = async (member: AdminMember) => {
    const nextRole = !member.isAdmin;
    const action = nextRole ? "授予管理员权限" : "取消管理员权限";
    if (!window.confirm(`确定要为“${member.username}”${action}吗？`)) return;
    setRoleBusy(member.id);
    setError("");
    try {
      const result = await api<{ user: Pick<AdminMember, "id" | "username" | "isAdmin"> }>(`/api/admin/users/${member.id}/admin`, {
        method: "PUT",
        body: JSON.stringify({ isAdmin: nextRole }),
      });
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, isAdmin: result.user.isAdmin } : item));
      if (member.id === currentUser.id) {
        onCurrentUserRoleChange(result.user.isAdmin);
        if (!result.user.isAdmin) return;
      }
      await Promise.all([loadMembers(), loadAudit()]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRoleBusy(null);
    }
  };

  const changeRegistration = async (enabled: boolean) => {
    setSettingsBusy(true);
    setError("");
    try {
      const result = await api<{ registrationEnabled: boolean }>("/api/admin/settings/registration", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setRegistrationEnabled(result.registrationEnabled);
      await Promise.all([loadMembers(), loadAudit()]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSettingsBusy(false);
    }
  };

  return <section className="admin-page">
    <header className="admin-header">
      <div><span className="eyebrow">管理员中心</span><h1>成员与服务器</h1><p>查看成员操作轨迹，并监控 RelayQR 运行状态。</p></div>
      <button className="button secondary" disabled={refreshing} onClick={() => void refreshAll()}><RefreshCw size={16} className={refreshing ? "spin" : ""} />刷新</button>
    </header>

    <nav className="admin-tabs">
      <button className={tab === "server" ? "active" : ""} onClick={() => setTab("server")}><Server size={17} />服务器监控</button>
      <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}><Users size={17} />成员与修改记录</button>
    </nav>

    {error && <div className="notice error">{error}<button onClick={() => setError("")}>×</button></div>}

    {tab === "server" && <ServerMonitor status={server} />}
    {tab === "members" && <div className="admin-members-layout">
      <article className="panel member-panel">
        <div className="panel-heading"><div><span className="panel-icon"><Users size={18} /></span><div><h3>成员</h3><p>{members.length} 名成员，{members.filter((member) => member.isAdmin).length} 名管理员</p></div></div></div>
        <div className="admin-setting-row"><div><strong>允许注册新账号</strong><small>{registrationEnabled ? "登录页允许新成员创建账号" : "仅现有成员可以登录"}</small></div><label className="switch"><input type="checkbox" checked={registrationEnabled} disabled={settingsBusy} onChange={(event) => void changeRegistration(event.target.checked)} /><span /></label></div>
        <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}>
          <span className="avatar">{member.username.slice(0, 1).toUpperCase()}</span>
          <div className="member-copy"><div><strong>{member.username}</strong>{member.isAdmin && <span className="admin-badge"><ShieldCheck size={11} />管理员</span>}</div><small>{member.codeCount} 个活码 · {member.auditCount} 条修改 · {member.lastActivityAt ? `最近 ${new Date(member.lastActivityAt).toLocaleString("zh-CN")}` : "暂无修改"}</small></div>
          <button className={`button compact ${member.isAdmin ? "danger-subtle" : "secondary"}`} disabled={roleBusy === member.id} onClick={() => void changeRole(member)}>{member.isAdmin ? "取消管理员" : "设为管理员"}</button>
        </div>)}</div>
      </article>

      <article className="panel audit-panel">
        <div className="audit-heading"><div><span className="panel-icon"><Clock3 size={18} /></span><div><h3>修改记录</h3><p>从启用审计功能后开始记录，不保存密码、答案等敏感内容</p></div></div><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">全部成员</option>{members.map((member) => <option value={member.id} key={member.id}>{member.username}</option>)}</select></div>
        {events.length ? <><div className="audit-table-wrap"><table><thead><tr><th>时间</th><th>成员</th><th>操作</th><th>对象</th><th>IP</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString("zh-CN")}</td><td><strong>{event.actorUsername}</strong></td><td>{event.action}</td><td>{event.resourceName ?? event.resourceId ?? "—"}</td><td><code>{event.ipAddress}</code></td></tr>)}</tbody></table></div>{auditHasMore && <button className="button ghost audit-more" disabled={auditLoading} onClick={() => void loadAudit(memberFilter, events.length)}>{auditLoading ? "加载中…" : "加载更多记录"}</button>}</> : <div className="admin-empty">{auditLoading ? "正在加载修改记录…" : "当前筛选条件下还没有修改记录"}</div>}
      </article>
    </div>}
  </section>;
}

function ServerMonitor({ status }: { status: ServerStatus | null }) {
  if (!status) return <div className="empty-panel">正在读取服务器状态…</div>;
  const systemUsed = status.memory.systemTotalBytes - status.memory.systemFreeBytes;
  return <div className="server-monitor">
    <div className="monitor-metrics">
      <article><span className="monitor-icon green"><Activity size={18} /></span><div><small>服务状态</small><strong>运行中</strong><em>已运行 {formatDuration(status.requests.uptimeSeconds)}</em></div></article>
      <article><span className="monitor-icon indigo"><RefreshCw size={18} /></span><div><small>每分钟请求</small><strong>{status.requests.requestsPerMinute}</strong><em>{status.requests.activeRequests} 个处理中</em></div></article>
      <article><span className="monitor-icon amber"><Clock3 size={18} /></span><div><small>平均响应</small><strong>{status.requests.averageResponseMs.toFixed(1)} ms</strong><em>累计 {status.requests.totalRequests.toLocaleString()} 次</em></div></article>
      <article><span className="monitor-icon red"><Server size={18} /></span><div><small>服务端错误率</small><strong>{(status.requests.errorRate * 100).toFixed(2)}%</strong><em>{status.requests.errorResponses} 次 5xx</em></div></article>
    </div>

    <div className="monitor-grid">
      <article className="panel resource-panel"><div className="panel-heading"><div><span className="panel-icon"><Server size={18} /></span><div><h3>计算资源</h3><p>{status.instance.cpuCount} 核 CPU · {status.instance.nodeVersion}</p></div></div></div>
        <ResourceBar label="系统内存" value={systemUsed} total={status.memory.systemTotalBytes} detail={`${formatBytes(systemUsed)} / ${formatBytes(status.memory.systemTotalBytes)}`} />
        <ResourceBar label="Node RSS" value={status.memory.processRssBytes} total={status.memory.systemTotalBytes} detail={formatBytes(status.memory.processRssBytes)} />
        <ResourceBar label="Node 堆内存" value={status.memory.processHeapUsedBytes} total={status.memory.processHeapTotalBytes} detail={`${formatBytes(status.memory.processHeapUsedBytes)} / ${formatBytes(status.memory.processHeapTotalBytes)}`} />
        <ResourceBar label="1 分钟系统负载" value={status.load.oneMinutePercent} total={100} detail={`${status.load.oneMinute.toFixed(2)} · CPU ${status.requests.processCpuPercent.toFixed(1)}%`} />
      </article>

      <article className="panel resource-panel"><div className="panel-heading"><div><span className="panel-icon"><HardDrive size={18} /></span><div><h3>存储</h3><p>RelayQR 数据卷所在文件系统</p></div></div></div>
        <ResourceBar label="磁盘使用" value={status.storage.usedBytes} total={status.storage.totalBytes} detail={`${formatBytes(status.storage.usedBytes)} / ${formatBytes(status.storage.totalBytes)}`} />
        <div className="monitor-facts"><div><span>SQLite 数据</span><strong>{formatBytes(status.storage.databaseBytes)}</strong></div><div><span>剩余空间</span><strong>{formatBytes(status.storage.freeBytes)}</strong></div><div><span>宿主运行时间</span><strong>{formatDuration(status.instance.hostUptimeSeconds)}</strong></div><div><span>实例</span><strong title={status.instance.hostname}>{status.instance.hostname}</strong></div></div>
      </article>

      <article className="panel data-panel"><div className="panel-heading"><div><span className="panel-icon"><Database size={18} /></span><div><h3>业务数据</h3><p>实时读取当前 SQLite 数据库</p></div></div></div><div className="data-counts">
        <div><span>成员 / 管理员</span><strong>{status.counts.users} / {status.counts.admins}</strong></div>
        <div><span>活码 / 运行中</span><strong>{status.counts.codes} / {status.counts.activeCodes}</strong></div>
        <div><span>累计扫描</span><strong>{status.counts.scans.toLocaleString()}</strong></div>
        <div><span>24 小时扫描</span><strong>{status.counts.scans24h.toLocaleString()}</strong></div>
        <div><span>有效会话</span><strong>{status.counts.activeSessions}</strong></div>
        <div><span>审计记录</span><strong>{status.counts.auditEvents.toLocaleString()}</strong></div>
      </div></article>
    </div>
    <p className="monitor-updated">每 5 秒自动刷新 · 最后更新 {new Date(status.generatedAt).toLocaleTimeString("zh-CN")}</p>
  </div>;
}

function ResourceBar({ label, value, total, detail }: { label: string; value: number; total: number; detail: string }) {
  return <div className="resource-row"><div><span>{label}</span><strong>{detail}</strong></div><div className="resource-track"><span style={{ width: `${percent(value, total)}%` }} /></div></div>;
}
