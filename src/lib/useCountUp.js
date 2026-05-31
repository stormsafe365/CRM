// useCountUp: animates a number from 0 to a target over a duration.
// Honors prefers-reduced-motion (snaps to final value instantly).
// Uses requestAnimationFrame with an ease-out-cubic curve.

import { useEffect, useRef, useState } from 'react'

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useCountUp(target, duration = 1100) {
  const [value, setValue] = useState(reduceMotion() ? target : 0)
  const startTime = useRef(null)
  const frame = useRef(null)
  const prevTarget = useRef(target)

  useEffect(() => {
    if (reduceMotion()) {
      setValue(target)
      return
    }

    // If the target changes, restart from current value rather than 0
    const startValue = prevTarget.current === target ? 0 : value
    prevTarget.current = target
    startTime.current = null

    function tick(now) {
      if (!startTime.current) startTime.current = now
      const t = Math.min((now - startTime.current) / duration, 1)
      // ease-out-cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(startValue + (target - startValue) * eased)
      if (t < 1) {
        frame.current = requestAnimationFrame(tick)
      }
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return value
}
