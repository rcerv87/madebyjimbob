// Builds the Android app in one go: the web app, copied into the Android project, then Gradle.
//   node mobile/scripts/build-android.mjs            debug build  → app/build/outputs/apk/debug/app-debug.apk
//   node mobile/scripts/build-android.mjs release    store build  → app/build/outputs/bundle/release/app-release.aab
//                                                    (and a signed app-release.apk to sideload)
//   --site http://localhost:3000                     a test build that talks to this PC's server (adb reverse)
// Notifications (MBJ-405) are switched on only when Firebase's settings file is there
// (mobile/android/app/google-services.json, see docs/MOBILE.md): without it, asking Android for a push token
// crashes the app.
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const android = path.join(root, 'mobile/android');
const args = process.argv.slice(2);
const release = args.includes('release');
const siteAt = args.indexOf('--site');
const site = siteAt >= 0 ? args[siteAt + 1] : '';
const firebase = existsSync(path.join(android, 'app/google-services.json'));

const env = { ...process.env };
if (site) env.VITE_SITE_URL = site;
if (firebase) env.VITE_NATIVE_PUSH = '1';
else delete env.VITE_NATIVE_PUSH;
// Android Studio's own Java and the SDK, where they're installed on Ruben's PC, unless already set.
env.JAVA_HOME ||= 'C:\\Program Files\\Android\\Android Studio\\jbr';
env.ANDROID_HOME ||= path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk');

function run(command, cwd) {
  console.log(`\n> ${command}`);
  const r = spawnSync(command, { cwd, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log(
  `Android ${release ? 'release' : 'debug'} build · talks to ${site || 'the live site'} · notifications ${
    firebase ? 'on' : 'off (no google-services.json)'
  }`,
);
run('npm run build -w web', root);
run('npx cap sync android', path.join(root, 'mobile'));
// By full path: Windows doesn't always look in the current folder for commands.
const gradle = `"${path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`;
run(`${gradle} ${release ? 'bundleRelease assembleRelease' : 'assembleDebug'}`, android);
console.log(
  release
    ? '\nDone: mobile/android/app/build/outputs/bundle/release/app-release.aab (and apk/release/app-release.apk)'
    : '\nDone: mobile/android/app/build/outputs/apk/debug/app-debug.apk',
);
