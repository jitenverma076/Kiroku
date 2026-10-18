# Security

## Reporting

Open an issue for anything that is not itself sensitive. For a vulnerability, contact
the maintainers privately first.

## Threat model

Kiroku is single-user. There is no account system, no server-side storage of your
documents, and no multi-tenancy — which also means there is nothing protecting your
data from anyone who can already use your browser profile or your machine.

| Threat | Mitigation |
|---|---|
| Malformed or hostile document | Parsing is sandboxed by the browser; a failure marks that document and never aborts the batch |
| Oversized upload | 50 MB per file, rejected before parsing |
| Data exfiltration | The browser engine sends no document data anywhere; the backend makes no network calls while processing |
| Path traversal (self-hosted) | Paths are validated against the managed storage directory |
| SQL injection (self-hosted) | All queries go through SQLAlchemy with bound parameters |
| Sensitive content in logs | Logs record filenames and status, never document text or amounts |

## Browser storage

Documents live in IndexedDB under the site's origin. What that means:

- **Not encrypted.** Anyone with access to your OS user account can read it. Turn on
  full-disk encryption if the machine is shared.
- **Erasable without warning.** "Clear site data", private windows, aggressive storage
  cleanup, and browser resets all destroy it. Use **Settings → Download backup**.
- **Per-origin and per-browser.** Nothing syncs between devices or profiles.
- **Visible to the page.** Browser dev tools can read everything, as with any web app.
- `crypto.subtle`, used for duplicate hashing, requires HTTPS or localhost.

## Self-hosted storage

The SQLite database and stored originals are plain files in `KIROKU_DATA_DIR`,
unencrypted, readable by any process running as your user. Back up that directory;
nothing is backed up automatically.

## Deployment note

The hosted frontend is static. Do not expose the optional Python backend publicly as
it stands: it has **no authentication** and a single shared database, so every visitor
would read and delete every other visitor's documents. It is designed to be run
locally, bound to `127.0.0.1`.
