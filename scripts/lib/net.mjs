// HTTP helper for the launcher and sync script.
// Quick-tunnel hostnames (*.trycloudflare.com) are brand new and some local/VPN resolvers
// do not know them for a while, so those are resolved through public DNS (1.1.1.1 / 8.8.8.8)
// before connecting. Everything else uses the normal system lookup.
import https from "node:https";
import http from "node:http";
import dns from "node:dns";

const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
const cache = new Map();

function publicLookup(hostname, options, cb) {
  if (typeof options === "function") (cb = options), (options = {});
  // net.connect (happy eyeballs) calls lookup with { all: true } and expects [{ address, family }]
  const reply = (ip) => (options?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4));
  const hit = cache.get(hostname);
  if (hit && hit.until > Date.now()) return reply(hit.ip);
  resolver.resolve4(hostname, (err, addrs) => {
    if (err || !addrs?.length) return dns.lookup(hostname, options, cb);
    cache.set(hostname, { ip: addrs[0], until: Date.now() + 60_000 });
    reply(addrs[0]);
  });
}

export function httpGet(url, { headers = {}, timeout = 8000, method = "GET", body } = {}) {
  const u = new URL(url);
  const isTunnel = /\.trycloudflare\.com$/.test(u.hostname);
  const mod = u.protocol === "https:" ? https : http;
  const t = Date.now();
  return new Promise((resolve) => {
    const req = mod.request(
      u,
      { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, timeout, ...(isTunnel ? { lookup: publicLookup } : {}) },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => resolve({ status: res.statusCode || 0, ms: Date.now() - t, body: data }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: 0, ms: Date.now() - t, error: e.code || e.message }));
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}
