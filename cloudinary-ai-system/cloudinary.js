const path = require("path");
const cloudinary = require("cloudinary").v2;
// Resolve .env next to this file, so the server works no matter which directory it's started from
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Upload an in-memory buffer, so no temp files are ever written to disk.
 */
function uploadBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: process.env.CLOUDINARY_FOLDER || "ai-image-studio",
        tags: ["ai-image-studio"],
        ...options,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

/**
 * Deletes an upload that produced no usable result, and purges any cached copies.
 */
function destroyUpload(publicId) {
  return cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
}

module.exports = cloudinary;
module.exports.isConfigured = isConfigured;
module.exports.uploadBuffer = uploadBuffer;
module.exports.destroyUpload = destroyUpload;
