# Privacy Notice

## Standard direct connection

The standard configuration uses a static GitHub Pages authorization helper,
then Wallpaper Engine connects directly to Spotify. It needs no operator API
server, VPS, Worker, D1, or companion process. Pages publication and real-account
acceptance are not established by this implementation.

The helper uses each user's Client ID and PKCE without a Client Secret.
GitHub receives the first callback HTTP request, including the short-lived
authorization code. The browser removes callback parameters promptly and
exchanges the code with Spotify. State/verifier and their transaction metadata
are temporary sessionStorage data. Successful credentials remain only in page
memory for explicit copy; the helper does not save tokens to cookies,
localStorage, GitHub, or an operator backend. No analytics are added.

The copied `swpt2.` or compatible `swpt1.` value contains a Refresh Token.
Base64url is not encryption. Wallpaper Engine's property retains the input;
the dedicated IndexedDB database `spotify-wallpaper-direct-credentials` stores
the current direct credential and update metadata in plaintext, separately
from preference JSON. OS profile location depends on the host and has not been
measured here. This storage is not an OS secret vault and cannot protect
against same-user malware, DevTools, or modified wallpaper code.

Clear the Spotify Token property to disconnect and remove active stored and
memory credentials. Non-secret retirement digests prevent old property data
from restoring the same authorization. Whole-storage deletion also removes
these records, so clear the property first and revoke the application in
Spotify account settings when appropriate. Clipboard history, profile backups,
and copies made by the user are outside this deletion mechanism.

Spotify receives playback/control and refresh requests under its own terms;
Spotify passwords are entered only on Spotify's official page. The wallpaper
does not record Spotify audio or bundle lyrics. GitHub's hosting privacy and
usage terms apply to the static page. Operator identity, effective date,
private contact, applicable legal review, and Spotify/GitHub publication
requirements remain prerequisites for release, not invented completed details.

## Retired hosted backend

The old Cloudflare Worker and its two D1 databases were deleted with user
approval on 2026-09-21. The public Node/PostgreSQL backend source and deployment
assets are removed. No hosted backend stores credentials for current direct
mode. The retained local Rust backend is optional. Historical operator terms
are archived and do not constitute current release approval.
