import { migrate } from './db.js';
import { server, ADMINS } from './app.js';

const PORT = process.env.PORT || 3000;

await migrate();
if (!ADMINS.size) console.warn('ADMIN_USERNAMES is empty, so nobody can open Studio.');
server.listen(PORT, () => console.log(`MadeByJimBob running on :${PORT}`));
