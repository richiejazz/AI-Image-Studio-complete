const express = require("express");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const cloudinary = require("./cloudinary");
const { imageUpload, HttpError } = require("./upload");
const proxyDiagnostic = require("./proxy-diagnostic");

const app = express();

app.disable("x-powered-by");
// Number of reverse proxies in front of the app (e.g. 1 on Render), so rate limiting sees real client IPs
app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);

app.use(proxyDiagnostic);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));

// Every processing request costs Cloudinary credits, so cap it per client
const processingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

function requireCloudinary(req, res, next) {
  if (!cloudinary.isConfigured()) {
    return next(new HttpError(503, "Image processing is unavailable: the server's Cloudinary credentials are not configured."));
  }
  next();
}

const processImage = [processingLimiter, requireCloudinary, imageUpload];

/**
 * Builds a preview URL (auto format/quality) and a download URL that forces
 * a file download in a fixed format.
 */
function variant(publicId, transformation, name, format = "jpg") {
  return {
    url: cloudinary.url(publicId, { ...transformation, fetch_format: "auto", quality: "auto" }),
    downloadUrl: cloudinary.url(publicId, {
      ...transformation,
      quality: "auto",
      format,
      flags: `attachment:${name}`,
    }),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Removes an upload that produced no usable result, since a retry always uploads
 * afresh. A failed cleanup is only logged so the caller can still report the real error.
 */
async function discardUpload(publicId) {
  try {
    await cloudinary.destroyUpload(publicId);
  } catch (err) {
    console.error("Couldn't delete unused upload", publicId + ":", err.message || err);
  }
}

/**
 * AI transformations are generated on first request and can fail if the account
 * doesn't support them, so request the derived image once before reporting success.
 */
async function ensureDerivedReady(url, { attempts = 15, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok) return;

    // 423 = still processing
    if (response.status !== 423) {
      const reason = response.headers.get("x-cld-error") || `HTTP ${response.status}`;
      console.error("Derived image failed:", reason);
      throw new HttpError(502, "Cloudinary could not generate this result. Background removal may not be enabled on this Cloudinary account.");
    }
    await sleep(delayMs);
  }
  throw new HttpError(504, "Cloudinary is still processing this image. Please try again in a moment.");
}

// Cached so the public health endpoint can't burn through Cloudinary's Admin API quota
let credentialCheck = { status: "unknown", expiresAt: 0 };

async function cloudinaryStatus() {
  if (!cloudinary.isConfigured()) return "missing";
  if (Date.now() < credentialCheck.expiresAt) return credentialCheck.status;

  let status;
  try {
    await cloudinary.api.ping();
    status = "ok";
  } catch (err) {
    const code = err.http_code || (err.error && err.error.http_code);
    status = code === 401 || code === 403 ? "rejected" : "unreachable";
  }
  const ttl = status === "unreachable" ? 60 * 1000 : 10 * 60 * 1000;
  credentialCheck = { status, expiresAt: Date.now() + ttl };
  return status;
}

app.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    cloudinaryConfigured: cloudinary.isConfigured(),
    // "ok" | "rejected" | "unreachable" | "missing"
    cloudinary: await cloudinaryStatus(),
  });
});

/**
 * UPLOAD + OPTIMIZE
 */
app.post("/upload", processImage, async (req, res) => {
  const result = await cloudinary.uploadBuffer(req.file.buffer);

  res.json({
    original: result.secure_url,
    ...variant(result.public_id, {}, "optimized"),
    public_id: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
  });
});

/**
 * REMOVE BACKGROUND
 */
app.post("/remove-background", processImage, async (req, res) => {
  const result = await cloudinary.uploadBuffer(req.file.buffer);
  // PNG download keeps the transparent background
  const output = variant(
    result.public_id,
    { transformation: [{ effect: "background_removal" }] },
    "background-removed",
    "png"
  );

  try {
    await ensureDerivedReady(output.downloadUrl);
  } catch (err) {
    await discardUpload(result.public_id);
    throw err;
  }

  res.json({
    original: result.secure_url,
    ...output,
    public_id: result.public_id,
  });
});

/**
 * FACE CROP
 */
const FACE_CROP_SIZES = [200, 400, 800];

app.post("/crop-face", processImage, async (req, res) => {
  const size = req.body.size === undefined ? 400 : Number(req.body.size);
  if (!FACE_CROP_SIZES.includes(size)) {
    throw new HttpError(400, `Size must be one of: ${FACE_CROP_SIZES.join(", ")}.`);
  }

  const result = await cloudinary.uploadBuffer(req.file.buffer, { faces: true });

  // Without a detected face Cloudinary silently crops the centre, so report it instead
  if (!result.faces || result.faces.length === 0) {
    await discardUpload(result.public_id);
    throw new HttpError(422, "No face was detected in this image. Try a clearer, front-facing photo.");
  }

  res.json({
    original: result.secure_url,
    ...variant(
      result.public_id,
      { crop: "thumb", gravity: "face", width: size, height: size },
      `face-${size}`
    ),
    facesDetected: result.faces.length,
    size,
  });
});

/**
 * SOCIAL OPTIMIZE
 */
const SOCIAL_PRESETS = [
  { id: "instagram-square", label: "Instagram post (square)", width: 1080, height: 1080 },
  { id: "instagram-portrait", label: "Instagram post (portrait)", width: 1080, height: 1350 },
  { id: "story", label: "Instagram / TikTok story", width: 1080, height: 1920 },
  { id: "facebook", label: "Facebook post", width: 1200, height: 630 },
  { id: "x", label: "X (Twitter) post", width: 1600, height: 900 },
  { id: "linkedin", label: "LinkedIn post", width: 1200, height: 627 },
  { id: "youtube", label: "YouTube thumbnail", width: 1280, height: 720 },
];

app.post("/social-optimize", processImage, async (req, res) => {
  const result = await cloudinary.uploadBuffer(req.file.buffer);

  res.json({
    original: result.secure_url,
    presets: SOCIAL_PRESETS.map((preset) => ({
      ...preset,
      ...variant(
        result.public_id,
        { width: preset.width, height: preset.height, crop: "fill", gravity: "auto" },
        preset.id
      ),
    })),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Only messages we wrote ourselves reach the client; everything else is logged
app.use((err, req, res, next) => {
  if (err.expose) {
    return res.status(err.status).json({ error: err.message });
  }

  const cloudinaryCode = err.http_code || (err.error && err.error.http_code);
  console.error("Request failed:", err.message || err);

  if (cloudinaryCode === 401 || cloudinaryCode === 403) {
    return res.status(503).json({ error: "Image processing is unavailable: the server's Cloudinary credentials were rejected." });
  }
  if (cloudinaryCode === 420 || cloudinaryCode === 429) {
    return res.status(503).json({ error: "The image service's usage limit was reached. Please try again later." });
  }
  if (cloudinaryCode === 400) {
    return res.status(422).json({ error: "Cloudinary could not process this image. Try a different file." });
  }
  res.status(500).json({ error: "Something went wrong while processing the image." });
});

module.exports = app;
