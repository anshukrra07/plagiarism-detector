# Deployment Notes

This backend reads configuration from environment variables.

## Required Environment Variables

- `MONGODB_URI`
  MongoDB connection string for submissions, pair results, and embedding cache.

## Optional Environment Variables

- `CORS_ORIGINS`
  Comma-separated list of frontend origins allowed to call the API.
  Example:
  `https://your-frontend.com,https://admin.your-frontend.com`

- `IEEE_XPLORE_API_KEY`
  Required only if you want `IEEE Xplore` available as a corpus source.
  If this is not set, IEEE Xplore is skipped and the app still works with other sources.

## Local Development

1. Copy `.env.example` to `.env`
2. Fill in real values
3. Start the backend

Example:

```bash
cd /Users/anshu/Downloads/projects/plagiarism_detector
cp .env.example .env
./venv/bin/uvicorn api.main:app --reload
```

## Hosted Deployment

Set the same variables in your hosting provider's environment-variable settings.

Common places:

- Render: service settings -> Environment
- Railway: Variables
- Vercel server/backend project: Environment Variables
- Docker: `-e MONGODB_URI=... -e IEEE_XPLORE_API_KEY=...`
- Kubernetes: Secret + env entries in the Deployment

## Render Deployment

### Backend Web Service

This repository now includes [render.yaml](/Users/anshu/Downloads/projects/plagiarism_detector/render.yaml) for the FastAPI backend.

Important Render requirements:

- bind to `0.0.0.0`
- bind to Render's `$PORT`
- do not use `--reload` in production

Equivalent Render settings are:

```bash
Build Command:
pip install -r requirements.txt
```

```bash
Start Command:
uvicorn api.main:app --host 0.0.0.0 --port $PORT
```

Environment variables to set in Render:

- `MONGODB_URI`
- `CORS_ORIGINS`
- `IEEE_XPLORE_API_KEY` if IEEE support is needed

If Render reports:

```text
Port scan timeout reached, no open ports detected
```

that usually means:

- the app did not start successfully
- the process is not binding to `0.0.0.0`
- the process is not using `$PORT`
- the app crashed during import/startup before the server opened

### Frontend on Render

Deploy the React app as a separate Render Static Site from the [`frontend/`](/Users/anshu/Downloads/projects/plagiarism_detector/frontend) folder.

Suggested settings:

```bash
Root Directory:
frontend
```

```bash
Build Command:
npm install && npm run build
```

```bash
Publish Directory:
build
```

Set this frontend environment variable:

```env
REACT_APP_API_URL=https://your-backend-service.onrender.com
```

Also set the backend `CORS_ORIGINS` to your deployed frontend URL.

## Current Backend Behavior

- If `MONGODB_URI` is not set, the app defaults to `mongodb://localhost:27017`
- If `CORS_ORIGINS` is not set, the backend defaults to `http://localhost:3000`
- If `IEEE_XPLORE_API_KEY` is not set, IEEE Xplore is not used
