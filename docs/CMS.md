# CMS

Migration 0114. One identity record + one content store + one media
library, read by **four surfaces**: the public site, the portal, the
console chrome, and the email layout. Staff edit in Operations Center →
Content (CMS) (`requireModule("cms")`).

## The five stores

### `cms_brand` — the identity record

Singleton (`id = "brand"`). Two JSON copies:

- **`draft`** — the working copy; `PUT /cms/brand` saves here.
- **`published`** — what `GET /api/v1/brand.json` serves;
  `POST /cms/brand/publish` copies draft → published, bumps
  `publishedVersion`, stamps publisher + IP in the audit stream.
  `POST /cms/brand/revert` discards the draft back to published.

The schema (`brandSchema` in `century-nit-shared`) covers names
(full/short), logos, colors, contact lines, socials — the portal's
`useBrand()` hook reads it, so a rebrand ships without a deploy.

### `cms_entries` — content collections

`(collection, slug)`-keyed JSON payloads with a status lifecycle:

```
draft → review → published     (+ scheduledAt for timed publish)
```

`CMS_COLLECTIONS` enumerates valid collections. `POST /cms/entries`
upserts (validates slug `^[a-z0-9-]+$`); `POST /{id}/status` moves the
lifecycle; `GET /content/{collection}` and `…/{slug}` are the **public**
reads (published only, `Cache-Control: public, max-age=60,
stale-while-revalidate=300`).

Catalogue tables (`catalog_universities`, `catalog_programs`,
`catalog_scholarships`, `destinations`) carry matching `seo` + `heroMediaId`
columns so CMS content and catalogue records share one media library and
SEO shape.

### `cms_versions` — history for everything

Every brand save/publish and entry write appends a version row
(`entity`, `entityKey`, `version`, `payload`, editor, note).
`GET /cms/brand/history` and `GET /cms/entries/{collection}/{slug}/history`
read it; `POST /cms/entries/{id}/revert` restores any version.

### `cms_nav` — navigation per surface

`surface`-keyed link lists (`header` | `footer`), items validated by
`navItemSchema`. `GET /api/v1/nav/{surface}` public, `GET/PUT
/cms/nav/{surface}` admin.

### `copy_keys` — fine-grained copy

`(key, surface)`-keyed strings for site/portal/console/email — the single
source for every label that's content, not code. `status` draft/published;
`GET /api/v1/copy?surface=` serves published only.

## The media library — `media`

Metadata rows over the **private** Supabase bucket:

- **Upload** — `POST /cms/media/upload-url` mints a signed PUT URL under
  `media/`; the browser uploads straight to storage; `POST /cms/media`
  registers the row (filename, mime, size, dimensions, alt).
- **Edit** — `PATCH /cms/media/{id}`: alt text + focal point
  (`focalX`/`focalY` 0–100) for smart cropping.
- **Public read** — `GET /api/v1/media/{key}`: the key must exist as a
  `media` row (**that's the authorization** — a random document key 404s),
  then 302 → signed download URL. The redirect is edge-cacheable just under
  the signed URL's TTL (~2900 s), so hot images don't re-sign per hit.

## Route map

| | |
|---|---|
| Public | `GET /api/v1/brand.json` · `/content/{c}[/{s}]` · `/nav/{s}` · `/copy?surface=` · `/media/{key}` |
| Admin `/cms` | `GET/PUT /brand` · `POST /brand/publish` `/brand/revert` · `GET /brand/history` · `GET/POST /entries` · `POST /entries/{id}/status` `/entries/{id}/revert` · `GET /entries/{c}/{s}/history` · `GET /media` `POST /media[/upload-url]` `PATCH /media/{id}` · `GET/PUT /nav/{s}` · `GET/PUT /copy` |

Public reads carry `Cache-Control: public, max-age=60, stale-while-revalidate=300`
— the site renders fresh-enough content while the edge absorbs the load.
