// One command that brings up everything the voice agent needs and keeps it alive:
//
//   npm run up
//
// 1. builds if .next is missing, starts `next start -p 3000`, waits for /api/agent/feed
// 2. starts a cloudflared quick tunnel and reads its https://*.trycloudflare.com URL
// 3. syncs the ElevenLabs agent + tools to that URL (scripts/setup-agent.mjs)
// 4. pre-warms every GET endpoint and the Daytona sandbox
// 5. health loop every 20s: restarts the server or tunnel if either dies, re-syncs if the URL changed
// Ctrl+C stops everything.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { httpGet } from "./lib/net.mjs";

const PORT = Number(process.env.PORT || 3000);
const LOCAL = `http://localhost:${PORT}`;
const HEALTH_EVERY_MS = 20_000;

/* env */
const envText = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
for (const line of envText.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const AGENT_KEY = process.env.CUIDA_AGENT_KEY || "";

const ts = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const log = (tag, msg) => console.log(`${ts()} [${tag}] ${msg}`);

let server = null;
let tunnel = null;
let tunnelUrl = "";
let syncedUrl = "";
let shuttingDown = false;
let restartingServer = false;
let restartingTunnel = false;

function pipe(child, tag, onLine) {
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        if (line) {
          console.log(`${ts()} [${tag}] ${line}`);
          onLine?.(line);
        }
      }
    });
  }
}

const http = (url, opts) => httpGet(url, opts);

/* 1. server */
function ensureBuilt() {
  if (existsSync(".next/BUILD_ID")) return;
  log("build", "no production build found, running `next build` (about a minute)");
  const r = spawnSync("npx", ["next", "build"], { stdio: "inherit" });
  if (r.status !== 0) {
    log("build", "build failed, exiting");
    process.exit(1);
  }
}
async function startServer() {
  ensureBuilt();
  // make sure nothing else (like an old `next dev`) holds the port
  const held = spawnSync("lsof", ["-t", `-iTCP:${PORT}`, "-sTCP:LISTEN"]).stdout.toString().trim();
  if (held) {
    log("server", `port ${PORT} is held by pid(s) ${held.replace(/\n/g, ",")}, stopping them`);
    for (const pid of held.split("\n")) try { process.kill(Number(pid), "SIGTERM"); } catch {}
    await sleep(1500);
  }
  log("server", `starting next start -p ${PORT}`);
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { env: { ...process.env, NODE_ENV: "production" } });
  pipe(server, "server");
  const s = server;
  s.on("exit", (code) => {
    if (shuttingDown) return;
    log("server", `exited with code ${code}`);
    if (server === s) server = null;
  });
  const t = Date.now();
  while (Date.now() - t < 90_000) {
    const r = await http(`${LOCAL}/api/agent/feed`, { timeout: 3000 });
    if (r.status === 200) {
      log("server", `ready on ${LOCAL} (${Date.now() - t}ms)`);
      return true;
    }
    if (!server) return false;
    await sleep(500);
  }
  log("server", "did not become ready in 90s");
  return false;
}

/* 2. tunnel */
function cloudflaredCmd() {
  const which = spawnSync("which", ["cloudflared"]).stdout.toString().trim();
  return which ? [which, []] : ["npx", ["-y", "cloudflared"]];
}
function startTunnel() {
  return new Promise((resolve) => {
    const [cmd, pre] = cloudflaredCmd();
    log("tunnel", `starting ${cmd === "npx" ? "npx cloudflared" : cmd} quick tunnel to ${LOCAL}`);
    tunnelUrl = "";
    tunnel = spawn(cmd, [...pre, "tunnel", "--url", LOCAL, "--no-autoupdate"]);
    const tn = tunnel;
    let resolved = false;
    const finish = (url) => {
      if (resolved) return;
      resolved = true;
      resolve(url);
    };
    pipe(tn, "tunnel", (line) => {
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !tunnelUrl) {
        tunnelUrl = m[0];
        log("tunnel", `public URL ${tunnelUrl}`);
        finish(tunnelUrl);
      }
    });
    tn.on("exit", (code) => {
      if (shuttingDown) return;
      log("tunnel", `exited with code ${code}`);
      if (tunnel === tn) tunnel = null;
      finish("");
    });
    setTimeout(() => finish(tunnelUrl), 60_000);
  });
}
async function waitTunnelReachable(url) {
  // the quick tunnel needs a few seconds after printing the URL before edge routes it
  const t = Date.now();
  while (Date.now() - t < 60_000) {
    const r = await http(`${url}/api/agent/feed`, { timeout: 8000 });
    if (r.status === 200) {
      log("tunnel", `reachable through ${url} (${r.ms}ms)`);
      return true;
    }
    await sleep(1500);
  }
  log("tunnel", `not reachable through ${url} after 60s`);
  return false;
}

/* 3. sync */
async function syncAgent(url) {
  log("sync", `syncing ElevenLabs agent + 11 tools to ${url}`);
  const r = spawnSync("node", ["scripts/setup-agent.mjs"], { stdio: "inherit", env: { ...process.env, PUBLIC_URL: url } });
  if (r.status === 0) {
    syncedUrl = url;
    log("sync", "done, agent tool URLs match the live tunnel");
    return true;
  }
  log("sync", `setup-agent.mjs failed (exit ${r.status}); tool URLs may be stale`);
  return false;
}

/* 4. pre-warm */
async function prewarm(base) {
  const H = { "x-cuida-key": AGENT_KEY };
  const gets = [
    "/api/agent/briefing",
    "/api/agent/medications?time_of_day=all",
    "/api/agent/appointments?range=upcoming",
    "/api/agent/search?q=pink%20pill",
    "/api/agent/documents?id=list",
    "/api/agent/feed",
  ];
  log("warm", `pre-warming through ${base}`);
  for (const p of gets) {
    const r = await http(base + p, { headers: H, timeout: 15000 });
    log("warm", `${String(r.status).padEnd(3)} ${String(r.ms + "ms").padStart(7)}  GET ${p}${r.error ? "  " + r.error : ""}`);
  }
  const r = await http(`${LOCAL}/api/analyze`, { timeout: 90_000 });
  log("warm", `${String(r.status).padEnd(3)} ${String(r.ms + "ms").padStart(7)}  GET /api/analyze (Daytona sandbox)${r.error ? "  " + r.error : ""}`);
}

/* 5. health loop */
let tunnelFails = 0;
async function health() {
  if (shuttingDown) return;
  // server
  const s = await http(`${LOCAL}/api/agent/feed`, { timeout: 5000 });
  if ((s.status !== 200 || !server) && !restartingServer) {
    restartingServer = true;
    log("health", `server unhealthy (${s.status || s.error}); restarting`);
    try { server?.kill("SIGTERM"); } catch {}
    await sleep(1000);
    await startServer();
    restartingServer = false;
  }
  // tunnel
  if (restartingTunnel) return;
  const t = tunnelUrl ? await http(`${tunnelUrl}/api/agent/feed`, { timeout: 8000 }) : { status: 0, error: "no url" };
  if (t.status === 200 && tunnel) {
    tunnelFails = 0;
    if (tunnelUrl !== syncedUrl) await syncAgent(tunnelUrl);
    return;
  }
  tunnelFails++;
  log("health", `tunnel check failed (${t.status || t.error}) ${tunnelFails}/2`);
  if (!tunnel || tunnelFails >= 2) {
    restartingTunnel = true;
    tunnelFails = 0;
    log("health", "restarting tunnel");
    try { tunnel?.kill("SIGTERM"); } catch {}
    await sleep(1000);
    const url = await startTunnel();
    if (url) {
      await waitTunnelReachable(url);
      if (url !== syncedUrl) {
        log("health", `tunnel URL changed to ${url}; re-syncing agent`);
        await syncAgent(url);
      }
    }
    restartingTunnel = false;
  }
}

/* shutdown */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("up", "stopping tunnel and server");
  try { tunnel?.kill("SIGTERM"); } catch {}
  try { server?.kill("SIGTERM"); } catch {}
  setTimeout(() => process.exit(0), 800);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/* main */
if (!(await startServer())) process.exit(1);
const url = await startTunnel();
if (!url) {
  log("tunnel", "could not get a tunnel URL; the health loop will keep retrying");
} else {
  await waitTunnelReachable(url);
  await syncAgent(url);
  await prewarm(url);
}
log("up", `running. server ${LOCAL}  tunnel ${tunnelUrl || "(none yet)"}  health check every ${HEALTH_EVERY_MS / 1000}s. Ctrl+C to stop.`);
setInterval(() => health().catch((e) => log("health", `error ${e}`)), HEALTH_EVERY_MS);
