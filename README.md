# AI Image Studio

Upload an image and let Cloudinary's AI transformations do the work:

- **Optimize**: upload and serve in the best format and quality for each browser
- **Remove background**: AI cut-out with a transparent PNG download
- **Face crop**: detects a face and crops a square avatar (200, 400 or 800 px)
- **Social media sizes**: smart-cropped versions for Instagram (square, portrait, story), TikTok, Facebook, X, LinkedIn and YouTube

## Architecture

```
frontend/              Vite + vanilla JS dashboard (static site)
cloudinary-ai-system/  Express API: validates uploads, talks to Cloudinary
```

The browser never sees Cloudinary credentials. It sends the image to the Express API, which uploads it to Cloudinary from memory (nothing is written to disk) and returns transformation URLs for preview and download.

| Endpoint | Description |
| --- | --- |
| `GET /health` | API status and whether Cloudinary accepts the credentials (`ok`, `rejected`, `unreachable` or `missing`; cached for a few minutes) |
| `POST /upload` | Upload and optimize |
| `POST /remove-background` | Background removal (waits until Cloudinary has generated the result) |
| `POST /crop-face` | Face crop; optional `size` field: `200`, `400` or `800` |
| `POST /social-optimize` | All social media presets |

All `POST` endpoints take `multipart/form-data` with one `image` field: a JPEG, PNG or WebP image up to 10 MB. The file's bytes are checked, not just its declared type. Processing endpoints are rate limited per IP.

## Run locally

Requires Node.js 20 or newer and a Cloudinary account.

```bash
# 1. API
cd cloudinary-ai-system
npm install
cp .env.example .env      # then fill in your Cloudinary credentials
npm run dev               # http://localhost:3000

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

If port 5173 is taken, run `npm run dev -- --port 5174` and add `http://localhost:5174` to `ALLOWED_ORIGINS` in the API's `.env`.

Run the API tests (Cloudinary is stubbed, so no credentials are needed):

```bash
cd cloudinary-ai-system
npm test
```

## Environment variables

**API (`cloudinary-ai-system/.env`)**, secret, server only:

| Variable | Description |
| --- | --- |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | Upload folder (default `ai-image-studio`) |
| `PORT` | Port to listen on (default `3000`; most hosts set it) |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins allowed by CORS |
| `RATE_LIMIT_MAX` | Processing requests per IP per 15 minutes (default `30`) |

**Frontend (`frontend/.env`)**, public, bundled into the browser build:

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | Base URL of the API, e.g. `https://your-api.example.com` |

Never put Cloudinary credentials in the frontend. Anything prefixed with `VITE_` is visible to everyone.

## Deployment

The two parts deploy separately.

**API**: any Node host (for example Render, Railway or Fly.io) as a web service:

- Root directory: `cloudinary-ai-system`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`
- Environment: the Cloudinary variables, `ALLOWED_ORIGINS=https://<your-frontend-domain>`

**Frontend**: any static host (for example Vercel, Netlify or Cloudflare Pages):

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Environment: `VITE_API_URL=https://<your-api-domain>`

Free API tiers often sleep when idle, so the first request after a pause can take up to a minute. The dashboard shows the API status and allows 90 seconds per request.

## Notes

- Background removal uses Cloudinary's `e_background_removal` transformation, which consumes transformation credits and may need to be enabled on your Cloudinary plan. If it isn't available, the API returns a clear error instead of a broken image.
- Every processed image is stored in your Cloudinary account under `CLOUDINARY_FOLDER` with the tag `ai-image-studio`. Clean these up periodically in the Media Library. Uploads that produce no result (no face detected, or background removal failed) are deleted automatically.
- The API reads `.env` once at startup, so restart it after changing credentials.
