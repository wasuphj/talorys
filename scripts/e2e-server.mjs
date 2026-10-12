import { spawn } from "node:child_process";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const state = join(root, ".wrangler/e2e-state");
rmSync(state, { recursive: true, force: true });
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");

let computerSecret = process.env.COMPUTER_MANAGER_SECRET;
const devVarsPath = join(root, "apps/agent/.dev.vars");
if (existsSync(devVarsPath)) {
  const content = readFileSync(devVarsPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("COMPUTER_MANAGER_SECRET=")) {
      computerSecret = trimmed.split("=")[1];
    }
  }
}
if (!computerSecret) {
  computerSecret = "e2e-computer-manager-secret";
}

const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  COMPUTER_MANAGER_SECRET: computerSecret,
  COMPUTER_MANAGER_URL: "http://127.0.0.1:38789",
  COMPUTER_SERVICE_PORT: "38789",
  TALORYS_AUTH_URL: "http://127.0.0.1:18788",
  TALORYS_BROWSER_ENGINE: "playwright",
  VITE_API_PROXY: "http://127.0.0.1:18788",
};

const procs = [
  spawn(process.execPath, [wrangler, "dev", "--local", "--port", "18787", "--inspector-port", "19229", "--persist-to", state], { cwd: join(root, "apps/agent"), env, stdio: "inherit" }),
  spawn(process.execPath, [wrangler, "pages", "dev", "dist", "--port", "18788", "--inspector-port", "19230", "--persist-to", `${state}-pages`], { cwd: join(root, "apps/web"), env, stdio: "inherit" }),
  spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--port", "5173", "--strictPort"], { cwd: join(root, "apps/web"), env, stdio: "inherit" }),
  spawn(process.execPath, [join(root, "services/computer-manager/dist/server.mjs")], { cwd: root, env, stdio: "inherit" }),
];
const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("exit", stop);
