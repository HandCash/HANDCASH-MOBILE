import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.handcash.mobile',
  appName: 'HandCash Mobile',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_handcash',
      iconColor: '#57ff97',
    },
    Keyboard: {
      // Do not shrink the WebView / flex layouts. Android adjustPan pans the
      // window; runtime also forces KeyboardResize.None.
      resize: 'none',
      resizeOnFullScreen: false,
    },
  },
}

export default config
