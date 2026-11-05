# Alpha-order-tracker – instructions for Claude

- Reply to the user in Hebrew, with detailed explanations.
- Full system spec: SPEC.md. Keep it updated with every functional change.
- ALWAYS back up before changing code: `git tag -a backup-YYYY-MM-DD-<topic>`, work on a branch (not main), and copy index.html to `..\Alpha-order-tracker-backups\` (outside the repo).
- Single index.html, no build step. RTL Hebrew UI.
- Excel export: exactly 5 columns (שם הפריט, כמות, פרויקט, קישור, הערות) – never the orderer column.
- Repo is PUBLIC: never commit passwords, tokens or user lists. Real data protection = Firestore Security Rules + Firebase Auth.
