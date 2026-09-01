/** The whole point of this prototype: does the browser give us what we need? */
export type Capability = { label: string; ok: boolean; detail: string }

export function probeCapabilities(): Capability[] {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true

  const iosMotionGate =
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof (DeviceMotionEvent as { requestPermission?: unknown }).requestPermission === 'function'

  const hasCamera = typeof navigator.mediaDevices?.getUserMedia === 'function'

  return [
    {
      label: 'Secure context (HTTPS)',
      ok: window.isSecureContext,
      detail: window.isSecureContext ? window.location.origin : 'camera + sensors will be blocked',
    },
    {
      label: 'Installed as PWA',
      ok: standalone,
      detail: standalone ? 'running standalone' : 'running in a browser tab',
    },
    {
      label: 'Camera (getUserMedia)',
      ok: hasCamera,
      detail: hasCamera ? 'available' : 'missing',
    },
    {
      label: 'Native BarcodeDetector',
      ok: 'BarcodeDetector' in window,
      detail: 'BarcodeDetector' in window ? 'native decoding' : 'falling back to jsQR',
    },
    {
      label: 'DeviceMotion',
      ok: typeof DeviceMotionEvent !== 'undefined',
      detail: iosMotionGate ? 'needs a permission prompt (iOS)' : 'no prompt needed',
    },
    {
      label: 'DeviceOrientation',
      ok: typeof DeviceOrientationEvent !== 'undefined',
      detail: typeof DeviceOrientationEvent !== 'undefined' ? 'available' : 'missing',
    },
    {
      label: 'Screen Wake Lock',
      ok: 'wakeLock' in navigator,
      detail: 'wakeLock' in navigator ? 'can keep the screen alive' : 'screen may sleep face-down',
    },
    {
      label: 'Service worker',
      ok: 'serviceWorker' in navigator,
      detail: 'serviceWorker' in navigator ? 'offline shell possible' : 'missing',
    },
  ]
}
