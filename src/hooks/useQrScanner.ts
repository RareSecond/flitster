import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

const getNativeDetector = (): BarcodeDetectorLike | null => {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (!Ctor) return null
  try {
    return new Ctor({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

/**
 * Camera QR scanner. Uses the native BarcodeDetector where it exists
 * (Chrome/Android) and falls back to jsQR over a canvas everywhere else
 * (notably iOS Safari, which has no BarcodeDetector).
 */
export function useQrScanner(onResult: (value: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<'native' | 'jsqr' | null>(null)

  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!window.isSecureContext) {
      setError('Camera needs HTTPS. Open the site over https:// (or localhost).')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('getUserMedia is not available in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true') // iOS: don't go fullscreen
      await video.play()
      setActive(true)

      const detector = getNativeDetector()
      setEngine(detector ? 'native' : 'jsqr')

      let busy = false
      const tick = async () => {
        rafRef.current = requestAnimationFrame(tick)
        if (busy || video.readyState < video.HAVE_CURRENT_DATA) return
        busy = true
        try {
          if (detector) {
            const codes = await detector.detect(video)
            if (codes[0]?.rawValue) onResultRef.current(codes[0].rawValue)
          } else {
            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d', { willReadFrequently: true })
            if (canvas && ctx) {
              // Downscale: jsQR on a full 720p frame is too slow for 60fps.
              const w = 480
              const h = Math.round((video.videoHeight / video.videoWidth) * w) || 640
              canvas.width = w
              canvas.height = h
              ctx.drawImage(video, 0, 0, w, h)
              const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {
                inversionAttempts: 'dontInvert',
              })
              if (code?.data) onResultRef.current(code.data)
            }
          }
        } catch {
          /* transient decode errors are expected */
        } finally {
          busy = false
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      const err = e as DOMException
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied.'
          : `Camera failed: ${err.name} ${err.message}`,
      )
    }
  }, [])

  useEffect(() => stop, [stop])

  return { videoRef, canvasRef, start, stop, active, error, engine }
}
