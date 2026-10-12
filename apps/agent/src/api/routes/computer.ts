import { Hono } from "hono";
import type { AppEnv } from "../app";
import { AppError } from "../errors";

const getManagerUrl = (c?: any) => c?.env?.COMPUTER_MANAGER_URL || c?.env?.env?.COMPUTER_MANAGER_URL || process.env.COMPUTER_MANAGER_URL || "http://127.0.0.1:28789";
const getManagerSecret = (c?: any): string => {
  const secret = c?.env?.COMPUTER_MANAGER_SECRET || c?.env?.env?.COMPUTER_MANAGER_SECRET || process.env.COMPUTER_MANAGER_SECRET;
  if (!secret?.trim()) {
    throw new AppError("INTERNAL_ERROR", "COMPUTER_MANAGER_SECRET is not configured (fail-closed).");
  }
  return secret.trim();
};

export const computerRoutes = new Hono<AppEnv>();

async function forwardToManager(c: any, path: string, method = "GET", body?: unknown) {
  try {
    const res = await fetch(`${getManagerUrl(c)}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getManagerSecret(c)}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return c.json(data, 409);
    }
    if (!res.ok) {
      throw new AppError("INTERNAL_ERROR", (data as any)?.error || `Computer manager error (${res.status})`);
    }
    return c.json(data);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("INTERNAL_ERROR", `Failed to reach computer manager: ${err instanceof Error ? err.message : String(err)}`);
  }
}

computerRoutes.post("/computer/session/start", async (c) => {
  return forwardToManager(c, "/session/start", "POST");
});

computerRoutes.post("/computer/session/stop", async (c) => {
  return forwardToManager(c, "/session/stop", "POST");
});

computerRoutes.get("/computer/session/status", async (c) => {
  return forwardToManager(c, "/session/status", "GET");
});

computerRoutes.post("/computer/session/take-control", async (c) => {
  return forwardToManager(c, "/session/take-control", "POST");
});

computerRoutes.post("/computer/session/return-control", async (c) => {
  return forwardToManager(c, "/session/return-control", "POST");
});

computerRoutes.post("/computer/action", async (c) => {
  const body = await c.req.json();
  return forwardToManager(c, "/action", "POST", body);
});

computerRoutes.all("/computer/vnc/*", async (c) => {
  const url = new URL(c.req.url);
  const vncPath = url.pathname.replace(/^\/api\/computer\/vnc/, "") || "/";
  const targetUrl = `${getManagerUrl(c)}/vnc${vncPath}${url.search}`;

  const secret = getManagerSecret(c);
  const headers = new Headers(c.req.raw.headers);
  headers.set("Authorization", `Bearer ${secret}`);

  if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
    return fetch(targetUrl, {
      method: c.req.method,
      headers,
    });
  }

  const res = await fetch(targetUrl, {
    method: c.req.method,
    headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
  });

  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
});

computerRoutes.all("/computer/vnc", async (c) => {
  return c.redirect("/api/computer/vnc/index.html");
});
