// Rate limiting behind Render. Headers mirror the chain observed in production on 2026-10-22:
// X-Forwarded-For = "<visitor-supplied>, visitor, Cloudflare edge, Render proxy" (both proxies
// rotate) and CF-Connecting-IP = visitor. Cloudflare rejects visitor-supplied CF-Connecting-IP.
process.env.CLOUDINARY_CLOUD_NAME = "demo-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.RATE_LIMIT_MAX = "2";
process.env.TRUST_PROXY = "1";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../app");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

let hop = 0;

// No file, so the request is counted by the limiter and then rejected before any upload
function post({ visitor, spoofed = [], headers = {} }) {
  // A different Cloudflare edge and Render proxy on every request, as in production
  hop += 1;
  const chain = [...spoofed, visitor, `172.70.${hop % 250}.${hop}`, `10.24.${hop % 250}.${hop}`].filter(Boolean);
  return fetch(baseUrl + "/upload", {
    method: "POST",
    headers: {
      "X-Forwarded-For": chain.join(", "),
      ...(visitor && { "CF-Connecting-IP": visitor }),
      ...headers,
    },
  });
}

test("one visitor shares a limit while Cloudflare and Render proxies rotate", async () => {
  assert.equal((await post({ visitor: "198.51.100.10" })).status, 400);
  assert.equal((await post({ visitor: "198.51.100.10" })).status, 400);
  assert.equal((await post({ visitor: "198.51.100.10" })).status, 429);
});

test("different visitors get separate limits", async () => {
  assert.equal((await post({ visitor: "198.51.100.20" })).status, 400);
  assert.equal((await post({ visitor: "198.51.100.20" })).status, 400);
  assert.equal((await post({ visitor: "198.51.100.20" })).status, 429);
  assert.equal((await post({ visitor: "198.51.100.21" })).status, 400);
});

test("spoofed X-Forwarded-For entries can't bypass the limit", async () => {
  assert.equal((await post({ visitor: "198.51.100.30", spoofed: ["203.0.113.1"] })).status, 400);
  assert.equal((await post({ visitor: "198.51.100.30", spoofed: ["203.0.113.2", "10.0.0.1"] })).status, 400);
  assert.equal((await post({ visitor: "198.51.100.30", spoofed: ["203.0.113.3"] })).status, 429);
});

test("IPv6 visitors are limited per /56, so rotating addresses in one network don't help", async () => {
  assert.equal((await post({ visitor: "2001:db8:aa:bb00::1" })).status, 400);
  assert.equal((await post({ visitor: "2001:db8:aa:bb11::2" })).status, 400);
  assert.equal((await post({ visitor: "2001:db8:aa:bbff::3" })).status, 429);
});

test("a malformed CF-Connecting-IP isn't used as a key", async () => {
  // Without a usable header the limiter falls back to req.ip, shared by these requests
  const bogus = (value) => post({ headers: { "CF-Connecting-IP": value, "X-Forwarded-For": "198.51.100.40, 10.24.0.1" } });
  assert.equal((await bogus("not-an-ip-1")).status, 400);
  assert.equal((await bogus("not-an-ip-2")).status, 400);
  assert.equal((await bogus("not-an-ip-3")).status, 429);
});
