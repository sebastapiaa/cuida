// HTTP helper for the launcher and sync script.
// Quick-tunnel hostnames (*.trycloudflare.com) are brand new and this laptop's local/VPN
// resolver often cannot answer (or hangs), so those are resolved with DNS-over-HTTPS straight
// to 1.1.1.1 by IP (no UDP DNS involved), cached, and the last good IP is kept as a fallback.
// Every request also has a hard overall deadline so a hung lookup can never stall a caller.
import https from "node:https";
import http from "node:http";
import dns from "node:dns";

const cache = new Map(); // hostname -> { ip, until }

function dohResolve(hostname) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: "1.1.1.1", servername: "cloudflare-dns.com", path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`, headers: { accept: "application/dns-json", host: "cloudflare-dns.com" }, timeout: 3000 },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            const a = (JSON.parse(data).Answer || []).find((x) => x.type === 1);
            resolve(a ? a.data : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

function publicLookup(hostname, options, cb) {
  if (typeof options === "function") (cb = options), (options = {});
  const reply = (ip) => (options?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4));
  const hit = cache.get(hostname);
  if (hit && hit.until > Date.now()) return reply(hit.ip);
  dohResolve(hostname).then((ip) => {
    if (ip) {
      cache.set(hostname, { ip, until: Date.now() + 120_000 });
      return reply(ip);
    }
    if (hit) return reply(hit.ip); // stale but better than failing on a DNS blip
    // last resort: system resolver, bounded by the caller's deadline
    dns.lookup(hostname, options, cb);
  });
}

export function httpGet(url, { headers = {}, timeout = 8000, method = "GET", body } = {}) {
  const u = new URL(url);
  const isTunnel = /\.trycloudflare\.com$/.test(u.hostname);
  const mod = u.protocol === "https:" ? https : http;
  const t = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve(r);
    };
    const req = mod.request(
      u,
      { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, timeout, ...(isTunnel ? { lookup: publicLookup } : {}) },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => finish({ status: res.statusCode || 0, ms: Date.now() - t, body: data }));
      }
    );
    const deadline = setTimeout(() => {
      req.destroy(new Error("deadline"));
      finish({ status: 0, ms: Date.now() - t, error: "deadline" });
    }, timeout + 2000);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => finish({ status: 0, ms: Date.now() - t, error: e.code || e.message }));
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}
