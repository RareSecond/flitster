import { useCallback, useEffect, useRef, useState } from 'react'

export type MotionPermission = 'unknown' | 'granted' | 'denied' | 'not-required' | 'unsupported'

type Ios13Motion = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> }
type Ios13Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> }

const needsExplicitPermission = () =>
  typeof DeviceMotionEvent !== 'undefined' &&
  typeof (DeviceMotionEvent as Ios13Motion).requestPermission === 'function'

/**
 * Detects the phone being turned face-down.
 *
 * We deliberately do NOT trust the absolute sign of gravity on the z axis:
 * iOS and Android disagree about its direction. Instead we take a baseline
 * reading while the user is still looking at the screen, and fire when the
 * z component swings past a threshold in the opposite direction.
 *
 * Falls back to `deviceorientation` (|beta| near 180 == face-down) on devices
 * that expose orientation but no accelerometer values.
 */
export function useFlipDetector(opts: { armed: boolean; onFlip: () => void }) {
  const { armed, onFlip } = opts

  const [permission, setPermission] = useState<MotionPermission>(() => {
    if (typeof DeviceMotionEvent === 'undefined' && typeof DeviceOrientationEvent === 'undefined') {
      return 'unsupported'
    }
    return needsExplicitPermission() ? 'unknown' : 'not-required'
  })
  const [source, setSource] = useState<'motion' | 'orientation' | 'none'>('none')
  const [z, setZ] = useState<number | null>(null)
  const [beta, setBeta] = useState<number | null>(null)
  const [faceDown, setFaceDown] = useState(false)

  const baselineSign = useRef<number>(0)
  const firedRef = useRef(false)
  const onFlipRef = useRef(onFlip)
  onFlipRef.current = onFlip

  /** Must be called from inside a user gesture on iOS. */
  const requestPermission = useCallback(async () => {
    if (!needsExplicitPermission()) {
      setPermission('not-required')
      return true
    }
    try {
      const motion = await (DeviceMotionEvent as Ios13Motion).requestPermission!()
      // Orientation has its own prompt; ask for it too so the fallback works.
      const orientationApi = DeviceOrientationEvent as Ios13Orientation
      if (typeof orientationApi.requestPermission === 'function') {
        await orientationApi.requestPermission().catch(() => undefined)
      }
      const ok = motion === 'granted'
      setPermission(ok ? 'granted' : 'denied')
      return ok
    } catch {
      setPermission('denied')
      return false
    }
  }, [])

  // Re-arm on every new round.
  useEffect(() => {
    if (armed) {
      firedRef.current = false
      baselineSign.current = 0
      setFaceDown(false)
    }
  }, [armed])

  useEffect(() => {
    if (permission === 'denied' || permission === 'unsupported' || permission === 'unknown') return

    const fire = () => {
      if (firedRef.current) return
      firedRef.current = true
      setFaceDown(true)
      onFlipRef.current()
    }

    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity
      if (!g || g.z == null) return
      setSource('motion')
      setZ(g.z)
      if (!armed) return

      // Lock in which way "screen towards the user" points on this device.
      if (baselineSign.current === 0) {
        if (Math.abs(g.z) > 5) baselineSign.current = Math.sign(g.z)
        return
      }
      // Flipped == gravity on z now points the other way, and convincingly so.
      if (Math.sign(g.z) === -baselineSign.current && Math.abs(g.z) > 6.5) fire()
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta == null) return
      setBeta(e.beta)
      if (source === 'motion') return // motion wins when both are live
      setSource('orientation')
      if (!armed) return
      if (Math.abs(e.beta) > 150) fire()
    }

    window.addEventListener('devicemotion', onMotion)
    window.addEventListener('deviceorientation', onOrientation)
    return () => {
      window.removeEventListener('devicemotion', onMotion)
      window.removeEventListener('deviceorientation', onOrientation)
    }
  }, [armed, permission, source])

  return { permission, requestPermission, source, z, beta, faceDown }
}
