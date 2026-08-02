import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyBrandPalette } from '@aeon-ui/core'
import 'aeon-ui-engine/aeon.css'
import '@aeon-ui/panda/electron.css'
import '@desktop/styles/handcash.css'
import './mobile-overrides.css'
import { installMobileBridge } from './bridge'
import { App } from '@desktop/App'

installMobileBridge()

applyBrandPalette(
  {
    bg: '#000000',
    surface: '#0a0a0a',
    surfaceRaised: '#141414',
    border: '#262626',
    text: '#fafafa',
    muted: '#a1a1aa',
    accent: '#57ff97',
    accentDim: 'rgba(87, 255, 151, 0.14)',
    danger: '#f87171',
    font: "'Archivo', ui-sans-serif, system-ui, sans-serif",
    fontDisplay: "'Syncopate', 'Archivo', ui-sans-serif, sans-serif",
    radius: '0.5rem',
  },
  { mode: 'dark', themeId: 'handcash' },
)

document.documentElement.classList.add('platform-mobile')
document.documentElement.dataset.aeonPlatform = window.handcash?.platform || 'android'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
