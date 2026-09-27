# NANO SPACE

A compact, fully responsive gallery/content dashboard built with Node.js, Express, EJS, and vanilla JS/CSS. All data is stored as JSON files on disk (no external database), and images are stored under `public/uploads/`. Features a dashboard, gallery with search/sort, an inspection lightbox, create/edit/delete flows with image uploads, a storage status page, settings, and a floating "Nano AI" assistant that answers questions from the JSON data (with optional external AI support).

## Requirements

- Node.js 18+

That's it — no database server to install or configure.

## Installation

```bash
npm install
```

## Environment

Copy the example env file:

```bash
cp .env.example .env
```

```
PORT=3000
NODE_ENV=development

# Optional — enables external AI replies for the Nano assistant.
# If left blank, a local assistant answers from the JSON data instead.
ANTHROPIC_API_KEY=
```

## Data storage

All content lives in plain JSON files under `data/`:

```
data/
├── gallery_items.json   # array of { id, name, headline, description, image_url, created_at, updated_at }
└── activity.json        # array of { id, message, created_at }, most recent first
```

Both files are created automatically (as `[]`) on first run if they don't exist. Uploaded images are saved to `public/uploads/` with randomized, safe filenames, and served statically from `/uploads/...`.

Writes are serialized per-file in-process, so concurrent create/edit/delete requests can't corrupt the JSON. Because it's just files, backing up your data is as simple as copying the `data/` and `public/uploads/` folders.

## Start

```bash
npm start
```

Visit **http://localhost:3000** — fully responsive, so it also works well on phones and tablets (collapsible nav menu, stacked forms, scrollable tables, full-width modal and AI panel on small screens).

## Project structure

```
nano-space/
├── package.json
├── server.js
├── .env.example
├── README.md
├── routes/
│   └── app.js       # all application routes + the JSON "database" layer
├── views/
│   └── app.ejs       # all UI screens, rendered by the `page` variable
├── public/
│   └── uploads/      # uploaded images land here
└── data/
    ├── gallery_items.json
    └── activity.json
```

## Nano AI

The floating "Ask Nano" button opens a chat panel. By default it uses a lightweight local assistant that answers questions like "how many items do I have?", "gallery statistics", "what was recently uploaded?", and "storage status?" by reading the JSON files directly — no external API required.

If `ANTHROPIC_API_KEY` is set in `.env`, the `/api/ai` route will instead call the Anthropic API for richer responses, falling back to the local assistant if that call fails.

## Deploying

1. Copy the project (or `git clone` it) to your host.
2. Set `PORT` and `NODE_ENV=production` as environment variables.
3. Make sure the `data/` and `public/uploads/` folders are writable and persisted across deploys (on platforms with ephemeral filesystems — e.g. most serverless hosts — mount a persistent disk/volume for these two folders, since data won't survive a redeploy otherwise).
4. `npm install`
5. `npm start`

No credentials are hardcoded anywhere in the codebase.
