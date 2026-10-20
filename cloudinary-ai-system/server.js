const app = require("./app");
const { isConfigured } = require("./cloudinary");

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  if (!isConfigured()) {
    console.warn("Cloudinary credentials are missing; processing endpoints will return 503. See .env.example.");
  }
});
