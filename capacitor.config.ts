import type { CapacitorConfig } from '@capacitor/cli';

// The iOS / Android app wraps the normal production build (dist/).
// appId must be unique on the stores: change it to your own reverse-domain id before publishing.
const config: CapacitorConfig = {
  appId: 'app.dotlife.game',
  appName: 'DOT LIFE',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      iconColor: '#9fb4ff',
    },
  },
};

export default config;
