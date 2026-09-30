import { server, ADMIN_EMAILS } from './app.js';
import { usingFallbackSecret } from './auth.js';
import { logger } from './logger.js';

// Migrations run separately (`npm run migrate`, Render's pre-deploy command), not on boot.
const PORT = process.env.PORT || 3000;

if (!ADMIN_EMAILS.size) logger.warn('ADMIN_EMAILS is empty, so nobody can open Studio.');
if (usingFallbackSecret)
  logger.warn('BETTER_AUTH_SECRET is not set; using a secret derived from DATABASE_URL. Set it.');
server.listen(PORT, () => logger.info(`MadeByJimBob running on :${PORT}`));
