# Luxembourgish LOD Flashcards

React + Vite flashcards built around the official **Lëtzebuerger Online Dictionnaire (LOD)** data.

## Features

- Complete LOD-derived Luxembourgish → English flashcard dataset.
- Official LOD phonetic/IPA data when available.
- **Official LOD audio only** — no browser TTS and no guessed pronunciation.
- Learner filters including **All, A1, A2, B1, Family, Travel, Work, Food, Home, Health, School, Shopping, Time, Nature, People, Transport and Sports**.
- Additional LOD category topics are exposed in the topic selector when the sync discovers them.
- Search, reveal, shuffle, previous/next and locally stored “Learned” state.

## Local development

```bash
npm ci
npm run dev
```

The repository includes a generated dataset so the app can start immediately.

To refresh from LOD locally:

```bash
npm run sync:lod
npm run dev
```

The sync writes:

```text
public/data/lod-cards.json
public/data/lod-meta.json
public/data/lod-categories.json
```

## GitHub Pages deployment

This repository is GitHub-Pages-ready. The workflow is already located at:

```text
.github/workflows/deploy.yml
```

### One-time GitHub setup

1. Push the project to the `main` branch of your GitHub repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab and let the push deployment finish.

The Vite base path is calculated automatically from `GITHUB_REPOSITORY`, so project Pages URLs such as:

```text
https://USERNAME.github.io/REPOSITORY/
```

work without manually editing `vite.config.js`.

## LOD sync on GitHub

Normal pushes deploy the existing generated data and **do not crawl LOD again**.

A fresh LOD sync happens automatically once a week. To run it whenever you want:

1. Go to **Actions**.
2. Open **Deploy Luxembourgish Flashcards**.
3. Click **Run workflow**.
4. Leave **Refresh LOD data before deploying** enabled.
5. Click **Run workflow**.

GitHub will run:

```text
npm ci
→ npm run sync:lod
→ npm run build
→ deploy to GitHub Pages
```

The refreshed JSON is generated inside the workflow artifact; it is not committed back into Git history.

## Data/source policy

The vocabulary workflow uses LOD / Luxembourg Open Data for dictionary/category/audio data, plus the supplied 1000-common-words source only for the non-official **B1 study grouping**.

A1 and A2 are intended to match the official LOD A1/A2 category pages. B1 is a study grouping rather than an official LOD CEFR category in the supplied resources.

The app never uses browser text-to-speech. An audio control is shown only when the official LOD audio URL successfully loads.
