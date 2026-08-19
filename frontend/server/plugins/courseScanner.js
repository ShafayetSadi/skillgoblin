import { scanCoursesOnStartup, setupFileWatcher, initialScanStatus } from '../utils/courseWatcher';

// Nitro server plugin — completes the required-root startup scan before the
// server becomes ready, then starts the single chokidar watcher instance. This is the ONE place
// CHOKIDAR_POLLING_INTERVAL is parsed; setting it to 0 disables the watcher.
export default defineNitroPlugin(async () => {
  const scanned = await scanCoursesOnStartup();
  if (!scanned) {
    throw new Error(`Startup course scan failed: ${initialScanStatus.error || 'unknown error'}`);
  }

  const pollingInterval = parseInt(process.env.CHOKIDAR_POLLING_INTERVAL || '60000', 10);
  if (pollingInterval > 0) {
    setupFileWatcher(pollingInterval);
  } else {
    console.log('CHOKIDAR_POLLING_INTERVAL is set to 0. File watcher disabled.');
  }
});
