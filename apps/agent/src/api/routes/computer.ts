import { Hono } from "hono";
import type { AppEnv } from "../app";
import { AppError } from "../errors";

const getManagerUrl = (c?: any) => c?.env?.env?.COMPUTER_MANAGER_URL || process.env.COMPUTER_MANAGER_URL || "http://127.0.0.1:28789";
const getManagerSecret = (c?: any) => c?.env?.env?.COMPUTER_MANAGER_SECRET || process.env.COMPUTER_MANAGER_SECRET || "talorys-computer-internal-secret";

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
    if (!res.ok) {
      throw new AppError("INTERNAL_ERROR", (data as any)?.error || `Computer manager error (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("INTERNAL_ERROR", `Failed to reach computer manager: ${err instanceof Error ? err.message : String(err)}`);
  }
}

computerRoutes.post("/computer/session/start", async (c) => {
  const data = await forwardToManager(c, "/session/start", "POST");
  return c.json(data);
});

computerRoutes.post("/computer/session/stop", async (c) => {
  const data = await forwardToManager(c, "/session/stop", "POST");
  return c.json(data);
});

computerRoutes.get("/computer/session/status", async (c) => {
  const data = await forwardToManager(c, "/session/status", "GET");
  return c.json(data);
});

computerRoutes.post("/computer/session/take-control", async (c) => {
  const data = await forwardToManager(c, "/session/take-control", "POST");
  return c.json(data);
});

computerRoutes.post("/computer/session/return-control", async (c) => {
  const data = await forwardToManager(c, "/session/return-control", "POST");
  return c.json(data);
});
