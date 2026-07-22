export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface SessionUser {
  id: string;
  username: string;
}

export interface CodeRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  active_revision_id: string | null;
  style_json: string;
  icon_path: string | null;
  source_qr_path: string | null;
  fallback_enabled: number;
  fallback_show_link: number;
  gate_enabled: number;
  gate_config_json: string;
  redirect_enabled: number;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  target?: string | null;
  protocol?: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: SessionUser | null;
  }
}
