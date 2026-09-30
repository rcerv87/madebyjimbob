import { server, ADMINS } from './app.js';

// Migrations run separately (`npm run migrate`, Render's pre-deploy command), not on boot.
const PORT = process.env.PORT || 3000;

if (!ADMINS.size) console.warn('ADMIN_USERNAMES is empty, so nobody can open Studio.');
server.listen(PORT, () => console.log(`MadeByJimBob running on :${PORT}`));
