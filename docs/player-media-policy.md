# Player headshot policy

Huddle supports optional player headshots in its recommendation payloads and the Huddle-owned Aegis dashboard overlay. Images fail closed: initials are rendered unless the runtime explicitly enables images and the URL host is on an exact allowlist.

## Why FantasyPros images are blocked

[FantasyPros says player image URLs are licensed from Sportradar and are not included in the FantasyPros API license](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API). Huddle therefore:

- Removes image-, photo-, avatar-, portrait-, and headshot-named fields before a FantasyPros response is written to cache.
- Never maps FantasyPros image URLs into a player or recommendation object.
- Rejects media tagged as FantasyPros even if its host appears on the configured allowlist.

The rankings and projection data can still be used according to the applicable API tier; the image restriction is independent.

## Enabling a licensed source

Keep images disabled until there is written permission or a license covering display in this application. Then set these values in the untracked environment file for each league container:

```dotenv
HUDDLE_PLAYER_IMAGES_ENABLED=true
HUDDLE_PLAYER_IMAGE_ALLOWED_HOSTS=licensed-images.example.com
```

Multiple exact hosts are comma-separated. Huddle accepts only HTTPS URLs with no embedded credentials and no explicit port. A lookalike subdomain such as `licensed-images.example.com.attacker.test` does not match. The normalized player input must carry the candidate URL as `media.headshotUrl`, `headshotUrl`, `headshot.url`, `imageUrl`, `image_url`, or `player_image_url`. A displayed media object is reduced to:

```json
{
  "headshotUrl": "https://licensed-images.example.com/player.png",
  "provider": "licensed-provider",
  "attribution": "Required provider attribution",
  "licenseVerified": true
}
```

The Aegis overlay renders only media with `licenseVerified: true`, uses `referrerpolicy="no-referrer"`, and falls back to player initials if the image fails. Host permission and any required attribution still need to be reviewed before production use.

## Operations

- Do not add FantasyPros player-image hosts to the allowlist.
- Delete any legacy cache or snapshot created by an earlier implementation if it may contain unlicensed image URLs.
- Keep provider/license notes with the deployment record.
- Revoke the host from the allowlist immediately if the license changes.
