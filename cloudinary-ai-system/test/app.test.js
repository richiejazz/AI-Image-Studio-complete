// Cloudinary is stubbed: these tests cover validation, routing and response shapes,
// not the real Cloudinary service.
process.env.CLOUDINARY_CLOUD_NAME = "demo-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.RATE_LIMIT_MAX = "1000";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const cloudinary = require("../cloudinary");
const app = require("../app");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

let server;
let baseUrl;
let uploadResult;
let uploadOptions;
let derivedStatuses;
let destroyed;
let destroyError;
const realFetch = global.fetch;

before(async () => {
  cloudinary.uploadBuffer = async (buffer, options) => {
    uploadOptions = options;
    if (uploadResult instanceof Error) throw uploadResult;
    return uploadResult;
  };
  cloudinary.destroyUpload = async (publicId) => {
    if (destroyError) throw destroyError;
    destroyed.push(publicId);
  };
  // Stub only Cloudinary delivery URLs; requests to the test server go through
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://res.cloudinary.com/")) {
      const status = derivedStatuses.shift() ?? 200;
      return new Response(null, { status, headers: status >= 400 ? { "x-cld-error": "test error" } : {} });
    }
    return realFetch(url, init);
  };
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  global.fetch = realFetch;
  server.close();
});

beforeEach(() => {
  uploadResult = {
    public_id: "ai-image-studio/sample",
    secure_url: "https://res.cloudinary.com/demo-cloud/image/upload/v1/ai-image-studio/sample.jpg",
    width: 1080,
    height: 720,
    format: "jpg",
    bytes: 1234,
    faces: [[10, 10, 100, 100]],
  };
  uploadOptions = undefined;
  derivedStatuses = [];
  destroyed = [];
  destroyError = undefined;
});

function post(path, { file = JPEG, type = "image/jpeg", name = "photo.jpg", fields = {} } = {}) {
  const form = new FormData();
  if (file) form.append("image", new Blob([file], { type }), name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return realFetch(baseUrl + path, { method: "POST", body: form });
}

test("health reports credential status without exposing values, and caches the check", async () => {
  let pings = 0;
  cloudinary.api.ping = async () => {
    pings += 1;
    throw { error: { http_code: 401, message: "unknown api_key" } };
  };
  const res = await realFetch(baseUrl + "/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", cloudinaryConfigured: true, cloudinary: "rejected" });
  await realFetch(baseUrl + "/health");
  assert.equal(pings, 1);
});

test("rejects a request without a file", async () => {
  const res = await post("/upload", { file: null });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /No image received/);
});

test("rejects unsupported mime types", async () => {
  const res = await post("/upload", { file: Buffer.from("hello"), type: "text/plain", name: "a.txt" });
  assert.equal(res.status, 415);
});

test("rejects files whose bytes don't match the declared type", async () => {
  const res = await post("/upload", { file: Buffer.from("<svg></svg>"), type: "image/png", name: "fake.png" });
  assert.equal(res.status, 415);
  assert.match((await res.json()).error, /isn't a valid/);
});

test("rejects files over 10 MB", async () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
  const res = await post("/upload", { file: big });
  assert.equal(res.status, 413);
});

test("rejects unexpected file fields", async () => {
  const form = new FormData();
  form.append("other", new Blob([JPEG], { type: "image/jpeg" }), "a.jpg");
  const res = await realFetch(baseUrl + "/upload", { method: "POST", body: form });
  assert.equal(res.status, 400);
});

test("upload returns optimized preview and download URLs", async () => {
  const res = await post("/upload", { file: PNG, type: "image/png", name: "a.png" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.public_id, "ai-image-studio/sample");
  assert.equal(body.original, "https://res.cloudinary.com/demo-cloud/image/upload/v1/ai-image-studio/sample.jpg");
  assert.match(body.url, /f_auto,q_auto/);
  assert.match(body.downloadUrl, /fl_attachment:optimized/);
});

test("remove-background waits for the derived image and returns a PNG download", async () => {
  derivedStatuses = [423, 200];
  const res = await post("/remove-background");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.url, /upload\/e_background_removal\/f_auto,q_auto\//);
  assert.match(body.downloadUrl, /\.png\?/);
  assert.equal(derivedStatuses.length, 0);
  assert.deepEqual(destroyed, []);
});

test("remove-background reports when Cloudinary can't generate the result and deletes the unused upload", async () => {
  derivedStatuses = [400];
  const res = await post("/remove-background");
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Background removal may not be enabled/);
  assert.deepEqual(destroyed, ["ai-image-studio/sample"]);
});

test("remove-background still reports the original error when deleting the upload fails", async () => {
  derivedStatuses = [400];
  destroyError = new Error("destroy failed");
  const res = await post("/remove-background");
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Background removal may not be enabled/);
});

test("crop-face requests face detection and crops to the chosen size", async () => {
  const res = await post("/crop-face", { fields: { size: "800" } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(uploadOptions.faces, true);
  assert.match(body.url, /c_thumb,f_auto,g_face,h_800,q_auto,w_800/);
  assert.equal(body.facesDetected, 1);
  assert.deepEqual(destroyed, []);
});

test("crop-face reports when no face is detected and deletes the unused upload", async () => {
  uploadResult.faces = [];
  const res = await post("/crop-face");
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /No face was detected/);
  assert.deepEqual(destroyed, ["ai-image-studio/sample"]);
});

test("crop-face still reports no face when deleting the unused upload fails", async () => {
  uploadResult.faces = [];
  destroyError = new Error("destroy failed");
  const res = await post("/crop-face");
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /No face was detected/);
});

test("crop-face validates size", async () => {
  const res = await post("/crop-face", { fields: { size: "5000" } });
  assert.equal(res.status, 400);
});

test("social-optimize returns every platform preset", async () => {
  const res = await post("/social-optimize");
  assert.equal(res.status, 200);
  const { presets } = await res.json();
  assert.equal(presets.length, 7);
  const story = presets.find((p) => p.id === "story");
  assert.match(story.url, /c_fill,f_auto,g_auto,h_1920,q_auto,w_1080/);
  assert.match(story.downloadUrl, /fl_attachment:story/);
});

test("rejected Cloudinary credentials become a generic 503", async () => {
  uploadResult = Object.assign(new Error("Invalid api_key secret-detail"), { http_code: 401 });
  const res = await post("/upload");
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.doesNotMatch(body.error, /secret-detail/);
});

test("unexpected errors don't leak internal messages", async () => {
  uploadResult = new Error("internal stack detail");
  const res = await post("/upload");
  assert.equal(res.status, 500);
  assert.doesNotMatch((await res.json()).error, /internal stack detail/);
});

test("CORS only allows configured origins", async () => {
  const allowed = await realFetch(baseUrl + "/health", { headers: { Origin: "http://localhost:5173" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const blocked = await realFetch(baseUrl + "/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});

test("unknown routes return JSON 404", async () => {
  const res = await realFetch(baseUrl + "/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found." });
});
