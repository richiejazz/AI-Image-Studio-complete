const net = require("net");
const { createHash } = require("crypto");

// TEMPORARY: records how Render's proxies forward the client address, to choose a safe
// rate-limit key. Logs only the kind of each address, never an address or a hash of one.
// Only runs for requests that send X-Proxy-Diagnostic: <sha256 of the tester's own IP>.

const MAX_LOGS = 30;
let logged = 0;

function blockList(cidrs) {
  const list = new net.BlockList();
  for (const cidr of cidrs) {
    const [address, prefix] = cidr.split("/");
    list.addSubnet(address, Number(prefix), net.isIPv6(address) ? "ipv6" : "ipv4");
  }
  return list;
}

// https://www.cloudflare.com/ips-v4 and /ips-v6
const cloudflare = blockList([
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
]);
const internal = blockList([
  "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "fc00::/7", "fe80::/10", "::1/128",
]);
// TEST-NET-2: the tester sends spoofed values from this documentation-only range
const marker = blockList(["198.51.100.0/24"]);

function kind(value, expectedHash) {
  if (value === undefined) return "absent";
  let address = String(value).trim();
  if (address.startsWith("::ffff:")) address = address.slice(7);
  const family = net.isIP(address);
  if (!family) return "invalid";
  const type = family === 6 ? "ipv6" : "ipv4";
  if (createHash("sha256").update(address).digest("hex") === expectedHash) return "tester";
  if (marker.check(address, type)) return "spoofed";
  if (internal.check(address, type)) return "private";
  if (cloudflare.check(address, type)) return "cloudflare";
  return "other-public";
}

function proxyDiagnostic(req, res, next) {
  const expectedHash = req.get("x-proxy-diagnostic");
  if (logged < MAX_LOGS && /^[0-9a-f]{64}$/.test(expectedHash || "")) {
    try {
      logged += 1;
      const xff = req.get("x-forwarded-for");
      const chain = xff === undefined ? "absent" : `[${xff.split(",").map((a) => kind(a, expectedHash)).join(", ")}]`;
      const header = (name) => kind(req.get(name), expectedHash);
      console.log(
        `[proxy-diagnostic] socket=${kind(req.socket.remoteAddress, expectedHash)} xff=${chain}` +
          ` cf-connecting-ip=${header("cf-connecting-ip")} true-client-ip=${header("true-client-ip")}` +
          ` x-real-ip=${header("x-real-ip")} forwarded=${req.get("forwarded") === undefined ? "absent" : "present"}` +
          ` req.ip=${kind(req.ip, expectedHash)}`
      );
    } catch {
      // Diagnostics must never affect the request
    }
  }
  next();
}

module.exports = proxyDiagnostic;
