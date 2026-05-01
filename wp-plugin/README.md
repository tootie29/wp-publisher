# WP Publisher — Yoast REST Meta plugin

A 30-line WordPress plugin that exposes three Yoast SEO meta fields on the WordPress REST API so the WP Publisher dashboard's **Published** tab can show them for every post (not just ones the publisher created).

Without this plugin, the dashboard can only show:
- Meta title and meta description rendered by Yoast (already in `yoast_head_json`).
- Focus keyphrase only for posts created through the publisher (filled from local history).

With this plugin installed:
- Meta title and meta description are pulled from the raw Yoast fields (the template/text actually saved in the SEO box, not just the rendered output).
- Focus keyphrase shows for every post on the site, regardless of who created it.

## What it exposes

| Meta key | Field | Where in WP |
|---|---|---|
| `_yoast_wpseo_focuskw` | Focus keyphrase | Yoast SEO box → "Focus keyphrase" |
| `_yoast_wpseo_title` | SEO title (raw template) | Yoast SEO box → "SEO title" |
| `_yoast_wpseo_metadesc` | Meta description | Yoast SEO box → "Meta description" |

Read access on these fields follows the post's normal permissions. Write access via REST requires `edit_posts` capability.

## Install

1. Copy `wp-publisher-yoast-rest.php` into `wp-content/mu-plugins/` on the WordPress site.
   - If `mu-plugins/` doesn't exist, create it. (Files in this folder load automatically — no activation step.)
   - Alternative: zip the file and upload at **Plugins → Add New → Upload Plugin**, then activate.

2. That's it. Reload the **Published** tab in the dashboard. SEO title, meta description, and keyword should now populate for every post.

## What it does not do

- It does not modify any data — it only registers the existing Yoast fields as REST-readable.
- It does not require Yoast Premium. The free version of Yoast SEO stores the same meta keys.
- If Yoast isn't installed at all, the plugin still loads cleanly but the fields will be empty.
- It does not affect any other plugin or theme.

## Removing

Delete `wp-publisher-yoast-rest.php` from `mu-plugins/`. The fields will simply stop appearing in REST responses on the next request. No data is lost — Yoast still stores everything in post meta as it always did.
