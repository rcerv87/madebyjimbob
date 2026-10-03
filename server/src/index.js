import { server, ADMIN_EMAILS } from './app.js';
import { usingFallbackSecret } from './auth.js';
import { startErasureJob } from './deletion.js';
import { startLinkCheckJob } from './links.js';
import { startViewCleanup } from './views.js';
import { startReplacementJob } from './replacements.js';
import { startLiveJob, startArchiveJob } from './live.js';
import { logger } from './logger.js';

// Migrations run separately (`npm run migrate`, Render's pre-deploy command), not on boot.
const PORT = process.env.PORT || 3000;

if (!ADMIN_EMAILS.size) logger.warn('ADMIN_EMAILS is empty, so nobody can open Studio.');
if (usingFallbackSecret)
  logger.warn('BETTER_AUTH_SECRET is not set; using a secret derived from DATABASE_URL. Set it.');
server.listen(PORT, () => logger.info(`MadeByJimBob running on :${PORT}`));
// Erases accounts whose 30-day deletion wait is over (MBJ-118).
startErasureJob();
// Fills in the channel for confirmed YouTube links once that handle shows up in an import (MBJ-215).
startLinkCheckJob();
// Forgets who viewed what after a day; only today's views are needed to count each viewer once (MBJ-216).
startViewCleanup();
// Swaps in replacement files once Cloudflare has processed them, even with Studio closed (MBJ-701).
startReplacementJob();
// Finishes starting live servers and deletes idle, over-cap, or stray ones (ADR-004).
startLiveJob();
// Older live replays keep 720p and below (LIVE_HD_DAYS, MBJ-312); with B2 (development), replays also move there.
startArchiveJob();
