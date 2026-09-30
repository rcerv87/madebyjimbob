import { server, ADMINS } from './app.js';
import { logger } from './logger.js';

// Migrations run separately (`npm run migrate`, Render's pre-deploy command), not on boot.
const PORT = process.env.PORT || 3000;

if (!ADMINS.size) logger.warn('ADMIN_USERNAMES is empty, so nobody can open Studio.');
server.listen(PORT, () => logger.info(`MadeByJimBob running on :${PORT}`));
