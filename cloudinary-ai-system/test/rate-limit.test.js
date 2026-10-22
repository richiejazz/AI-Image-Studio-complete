// Rate limiting behind Render's proxies. Requests reach the test server from loopback,
// which stands in for Render's internal proxy, so X-Forwarded-For is read the same way.
process.env.CLOUDINARY_CLOUD_NAME = "demo-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.RATE_LIMIT_MAX = "2";

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

// No file, so the request is counted by the limiter and then rejected before any upload
function post(forwardedFor) {
  return fetch(baseUrl + "/upload", { method: "POST", headers: { "X-Forwarded-For": forwardedFor } });
}

test("one visitor shares a limit even when Render's internal proxy changes", async () => {
  assert.equal((await post("198.51.100.10, 10.24.86.133")).status, 400);
  assert.equal((await post("198.51.100.10, 10.25.239.2")).status, 400);
  assert.equal((await post("198.51.100.10, 10.27.144.40")).status, 429);
});

test("different visitors get separate limits", async () => {
  assert.equal((await post("198.51.100.20, 10.24.86.133")).status, 400);
  assert.equal((await post("198.51.100.20, 10.24.86.133")).status, 400);
  assert.equal((await post("198.51.100.20, 10.24.86.133")).status, 429);
  assert.equal((await post("198.51.100.21, 10.24.86.133")).status, 400);
});

test("spoofed X-Forwarded-For entries can't bypass the limit", async () => {
  assert.equal((await post("203.0.113.1, 198.51.100.30, 10.24.86.133")).status, 400);
  assert.equal((await post("203.0.113.2, 198.51.100.30, 10.25.239.2")).status, 400);
  // Private-looking spoofed entries don't help either
  assert.equal((await post("10.9.9.9, 198.51.100.30, 10.27.144.40")).status, 429);
  assert.equal((await post("203.0.113.3, 10.0.0.1, 198.51.100.30, 10.24.86.133")).status, 429);
});
