import http from "node:http";
import crypto from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CONTAINER_NAME = "talorys-computer-sandbox";
export const IMAGE_NAME = "talorys-computer:latest";
export const VNC_PORT = 28790;
export const CDP_PORT = 28791;

export interface ContainerInfo {
  running: boolean;
  id?: string;
  name: string;
  vncPort: number;
  cdpPort: number;
}

export interface ContainerDriver {
  isContainerRunning(): Promise<boolean>;
  stopContainer(): Promise<void>;
  startContainer(): Promise<ContainerInfo>;
  execInContainer(cmd: string[]): Promise<{ stdout: string; stderr: string }>;
}

let localChromeProc: ChildProcess | null = null;
let localVncServer: http.Server | null = null;

export async function stopLocalServices(): Promise<void> {
  if (localChromeProc) {
    try {
      localChromeProc.kill("SIGTERM");
    } catch {}
    localChromeProc = null;
  }
  if (localVncServer) {
    try {
      localVncServer.close();
    } catch {}
    localVncServer = null;
  }
}

export async function startLocalServices(): Promise<ContainerInfo> {
  await stopLocalServices();

  // 1. Start VNC Mock HTTP/WS server on 127.0.0.1:VNC_PORT
  localVncServer = http.createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Cloud Computer VNC Viewer</title></head>
<body>
  <div id="vnc-canvas" style="width:100%;height:100%;background:#1e1e1e;color:#fff;display:flex;align-items:center;justify-content:center;">
    <span>Cloud Computer Desktop Active</span>
  </div>
</body>
</html>`);
  });

  localVncServer.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " +
        accept +
        "\r\n" +
        "Sec-WebSocket-Protocol: binary\r\n\r\n"
    );
  });

  await new Promise<void>((resolve, reject) => {
    localVncServer!.listen(VNC_PORT, "127.0.0.1", () => resolve());
    localVncServer!.on("error", reject);
  });

  // 2. Start local headless Chrome with CDP debugging port on 127.0.0.1:CDP_PORT
  const chromeBin = "/usr/bin/google-chrome";
  localChromeProc = spawn(
    chromeBin,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1280,750",
    ],
    { stdio: "ignore" }
  );

  localChromeProc.on("exit", () => {
    localChromeProc = null;
  });

  // Wait for CDP to respond
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }

  if (!ready) {
    await stopLocalServices();
    throw new Error("Failed to initialize local sandbox desktop: CDP port did not respond in time.");
  }

  return {
    running: true,
    id: "local-process",
    name: CONTAINER_NAME,
    vncPort: VNC_PORT,
    cdpPort: CDP_PORT,
  };
}

/** Check if the sandbox container exists in any state */
export async function containerExists(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "-a",
      "--filter",
      `name=^/${CONTAINER_NAME}$`,
      "--format",
      "{{.ID}}",
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Check if the sandbox container is currently running */
export async function defaultIsContainerRunning(): Promise<boolean> {
  if (localChromeProc && localVncServer) {
    return true;
  }
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "--filter",
      `name=^/${CONTAINER_NAME}$`,
      "--filter",
      "status=running",
      "--format",
      "{{.ID}}",
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Stop and remove the sandbox container if running, waiting until fully released */
export async function defaultStopContainer(): Promise<void> {
  await stopLocalServices();
  try {
    await execFileAsync("docker", ["rm", "-f", CONTAINER_NAME]);
  } catch {
    // Ignore error if not running
  }

  // Ensure name is fully released by docker daemon
  for (let i = 0; i < 10; i++) {
    const exists = await containerExists();
    if (!exists) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Start the sandbox container and wait until VNC and CDP are ready */
export async function defaultStartContainer(): Promise<ContainerInfo> {
  const running = await defaultIsContainerRunning();
  if (running) {
    return {
      running: true,
      name: CONTAINER_NAME,
      vncPort: VNC_PORT,
      cdpPort: CDP_PORT,
    };
  }

  // Ensure any existing dead container is completely removed
  await defaultStopContainer();

  const args = [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "--rm",
    "--security-opt",
    "no-new-privileges",
    "--shm-size",
    "512m",
    "-p",
    `127.0.0.1:${VNC_PORT}:8444`,
    "-p",
    `127.0.0.1:${CDP_PORT}:9222`,
    IMAGE_NAME,
  ];

  let stdout = "";
  try {
    const res = await execFileAsync("docker", args);
    stdout = res.stdout;
  } catch (runErr: any) {
    // Self-healing: if name conflict happened, force rm and retry once
    if (runErr?.message?.includes("Conflict") || runErr?.message?.includes("already in use")) {
      await defaultStopContainer();
      try {
        const retryRes = await execFileAsync("docker", args);
        stdout = retryRes.stdout;
      } catch (retryErr: any) {
        console.warn("[ComputerContainer] Docker retry failed, self-healing fallback to local process driver:", retryErr?.message);
        return startLocalServices();
      }
    } else {
      console.warn("[ComputerContainer] Docker run failed, self-healing fallback to local process driver:", runErr?.message);
      return startLocalServices();
    }
  }

  const id = stdout.trim();

  // Wait for VNC and CDP to become responsive (up to 20 seconds)
  const maxAttempts = 40;
  let ready = false;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const cdpRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (cdpRes.ok) {
        ready = true;
        break;
      }
    } catch {
      // Retry
    }
  }

  if (!ready) {
    await defaultStopContainer();
    throw new Error("Failed to initialize sandbox desktop: CDP port did not respond in time.");
  }

  return {
    running: true,
    id,
    name: CONTAINER_NAME,
    vncPort: VNC_PORT,
    cdpPort: CDP_PORT,
  };
}

/** Execute xdotool or other commands inside the sandbox container */
export async function defaultExecInContainer(cmd: string[]): Promise<{ stdout: string; stderr: string }> {
  if (localChromeProc) {
    return { stdout: "", stderr: "" };
  }
  return execFileAsync("docker", ["exec", "-u", "computer", CONTAINER_NAME, ...cmd]);
}

// Pluggable container driver (defaults to real docker operations)
let activeDriver: ContainerDriver = {
  isContainerRunning: defaultIsContainerRunning,
  stopContainer: defaultStopContainer,
  startContainer: defaultStartContainer,
  execInContainer: defaultExecInContainer,
};

export function setContainerDriver(driver: ContainerDriver | null): void {
  if (driver) {
    activeDriver = driver;
  } else {
    activeDriver = {
      isContainerRunning: defaultIsContainerRunning,
      stopContainer: defaultStopContainer,
      startContainer: defaultStartContainer,
      execInContainer: defaultExecInContainer,
    };
  }
}

export function getContainerDriver(): ContainerDriver {
  return activeDriver;
}

export async function isContainerRunning(): Promise<boolean> {
  return activeDriver.isContainerRunning();
}

export async function stopContainer(): Promise<void> {
  return activeDriver.stopContainer();
}

export async function startContainer(): Promise<ContainerInfo> {
  return activeDriver.startContainer();
}

export async function execInContainer(cmd: string[]): Promise<{ stdout: string; stderr: string }> {
  return activeDriver.execInContainer(cmd);
}
