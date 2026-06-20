const express = require("express");
const multer = require("multer");
const cors = require("cors");
const cloudinary = require("./cloudinary");

const app = express();

app.use(cors({
  origin: "*"
}));

const upload = multer({ dest: "uploads/" });

/**
 * UPLOAD + OPTIMIZE
 */
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);

    const optimizedUrl = cloudinary.url(result.public_id, {
      fetch_format: "auto",
      quality: "auto",
    });

    res.json({
      url: result.secure_url,
      optimizedUrl,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * REMOVE BACKGROUND
 */
app.post("/remove-background", upload.single("image"), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);

    const url = cloudinary.url(result.public_id, {
      effect: "background_removal"
    });

    res.json({
      url,
      public_id: result.public_id
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * FACE CROP
 */
app.post("/crop-face", upload.single("image"), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);

    const url = cloudinary.url(result.public_id, {
      crop: "thumb",
      gravity: "face",
      width: 400,
      height: 400
    });

    res.json({ url });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * SOCIAL OPTIMIZE
 */
app.post("/social-optimize", upload.single("image"), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);

    const instagram = cloudinary.url(result.public_id, {
      width: 1080,
      height: 1080,
      crop: "fill",
      fetch_format: "auto",
      quality: "auto"
    });

    const tiktok = cloudinary.url(result.public_id, {
      width: 1080,
      height: 1920,
      crop: "fill",
      fetch_format: "auto",
      quality: "auto"
    });

    res.json({
      instagram,
      tiktok
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});