const multer = require("multer");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // Cloudinary free-plan image limit

const ALLOWED_TYPES = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) =>
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 5, fieldSize: 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new HttpError(415, "Unsupported file type. Please upload a JPEG, PNG or WebP image."));
    }
    cb(null, true);
  },
}).single("image");

/**
 * Parses a single "image" field and checks that the bytes match the declared type,
 * since the client-supplied mimetype alone can't be trusted.
 */
function imageUpload(req, res, next) {
  multerUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new HttpError(413, "Image is too large. The maximum size is 10 MB."));
      }
      return next(new HttpError(400, "Invalid upload. Send exactly one image in the \"image\" field."));
    }
    if (err) return next(err);

    if (!req.file) {
      return next(new HttpError(400, "No image received. Choose an image to upload."));
    }
    if (!ALLOWED_TYPES[req.file.mimetype](req.file.buffer)) {
      return next(new HttpError(415, "This file isn't a valid JPEG, PNG or WebP image."));
    }
    next();
  });
}

module.exports = { imageUpload, HttpError, MAX_FILE_SIZE };
