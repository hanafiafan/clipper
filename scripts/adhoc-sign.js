// electron-builder `afterPack` hook (macOS only): ad-hoc sign the whole .app when no real certificate is configured.
//
// Without it electron-builder skips signing, leaving only the Electron binary's linker signature while the bundle
// claims sealed resources ("code has no resources but signature indicates they must be present"). On Apple
// Silicon, a downloaded app in that state is reported as "damaged" and cannot be opened at all. An ad-hoc seal makes
// it a normal unidentified-developer app: right-click -> Open (or System Settings -> Privacy & Security -> Open Anyway).
// A paid Developer ID + notarization is still needed for a warning-free install; if CSC_LINK / CSC_NAME is set we do nothing.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  ${path.basename(app)}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
