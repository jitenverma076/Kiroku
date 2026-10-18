# Security

## Reporting

Open an issue for anything that is not itself sensitive. For a vulnerability, contact
the maintainers privately first.

## Threat model

Kiroku runs on one machine and listens on localhost only. It is not multi-user and has
no authentication — anyone with access to the account running it has access to the data.

| Threat | Mitigation |
|---|---|
| Malformed or hostile document | Each file is processed in isolation; failures mark the document `error` and never abort the run |
| Path traversal via filename | Paths are validated against the managed storage directory before any file operation |
| Oversized upload | 50 MB per file, enforced at the API layer |
| Sensitive content in logs | Logs record filenames and status, never document text or amounts |
| SQL injection | All queries go through SQLAlchemy with bound parameters |
| Data exfiltration | Processing makes no network calls; CORS is restricted to localhost |

## What is not protected

- **No encryption at rest.** The SQLite database and stored originals are plain files.
  Enable full-disk encryption (FileVault, BitLocker, LUKS) if the machine is shared.
- **No authentication.** Any local process running as your user can read the database.
- **Browser dev tools** can inspect API responses, which contain your document data.

## Network

Document processing is offline. The optional classifier in `requirements-ml.txt`
downloads model weights from the Hugging Face Hub on first use and caches them; after
that it runs offline. Skip that file, or set `KIROKU_DISABLE_ML=1`, for a build that
never reaches the network.

## Backups

Nothing is backed up automatically. Copy `data/` to keep your documents and records;
`data/previews/` can be regenerated.
