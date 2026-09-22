import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"

export type RevealOptions = {
  // Reveal rate in code points per second. A function is read every frame so
  // the rate can change at runtime (e.g. from a palette command).
  cps?: number | (() => number)
  // Client tick interval. The stream is revealed in steps of this size.
  frameMs?: number
  // Marks the source as final. The remaining text then drains over `tailMs`.
  final?: Accessor<boolean>
  // How long the tail drain takes once the source is final.
  tailMs?: number
}

const defaultOptions = {
  cps: 20,
  frameMs: 16,
  tailMs: 1000,
}

function resolveCps(cps: RevealOptions["cps"]): number {
  const value = typeof cps === "function" ? cps() : cps
  return value === undefined || !Number.isFinite(value) || value <= 0 ? defaultOptions.cps : value
}

type RevealHandle = {
  finish: () => void
}

const handles = new Set<RevealHandle>()
const pendings = new Set<symbol>()
const [pendingReveals, setPendingReveals] = createSignal(0)

// Number of reveals currently behind their source. Reactive.
export const revealPending = pendingReveals

// Immediately complete every active reveal.
export function finishReveals() {
  for (const handle of handles) handle.finish()
}

// Accumulate a fractional reveal rate so the average speed matches `cps`
// exactly regardless of how the frame interval divides the rate. Exported for tests.
export function revealStep(
  carry: number,
  backlog: number,
  options: RevealOptions = {},
): { step: number; carry: number } {
  if (backlog <= 0) return { step: 0, carry }
  const frameMs = options.frameMs ?? defaultOptions.frameMs
  const credit = carry + (resolveCps(options.cps) * frameMs) / 1000
  const step = Math.min(backlog, Math.floor(credit))
  return { step, carry: credit - step }
}

// Reveal a growing string over time instead of applying deltas in bursts.
// When disabled it returns the source unchanged and runs no timers.
export function createRevealText(
  source: Accessor<string>,
  enabled: Accessor<boolean>,
  options: RevealOptions = {},
): { text: Accessor<string>; pending: Accessor<boolean>; finish: () => void } {
  const frameMs = options.frameMs ?? defaultOptions.frameMs
  const tailMs = options.tailMs ?? defaultOptions.tailMs
  // Split into code points so surrogate pairs are never cut in half.
  const chars = createMemo(() => Array.from(source()))
  const [visible, setVisible] = createSignal(enabled() ? "" : source())
  const [pending, setPending] = createSignal(false)

  const id = Symbol("reveal")
  let revealed = enabled() ? 0 : chars().length
  let carry = 0
  let timer: ReturnType<typeof setInterval> | undefined
  // Fixed step for the final drain so the tail lasts roughly `tailMs`.
  let tailStep: number | undefined

  const mark = (value: boolean) => {
    if (value) pendings.add(id)
    else pendings.delete(id)
    setPendingReveals(pendings.size)
    setPending(value)
  }

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  const finish = () => {
    stop()
    revealed = chars().length
    carry = 0
    setVisible(chars().join(""))
    mark(false)
  }

  const handle: RevealHandle = { finish }
  handles.add(handle)
  onCleanup(() => {
    stop()
    if (pendings.delete(id)) setPendingReveals(pendings.size)
    handles.delete(handle)
  })

  const tick = () => {
    const target = chars().length
    // Once generation is done, drain the rest at a fixed step over the tail
    // window so the animation wraps up promptly instead of lagging behind.
    if (options.final?.()) {
      const frames = Math.max(1, Math.round(tailMs / frameMs))
      tailStep ??= Math.max(1, Math.ceil((target - revealed) / frames))
      revealed = Math.min(target, revealed + tailStep)
    } else {
      tailStep = undefined
      const next = revealStep(carry, target - revealed, options)
      carry = next.carry
      revealed = Math.min(target, revealed + next.step)
    }
    if (revealed >= target) {
      stop()
      setVisible(chars().join(""))
      mark(false)
      return
    }
    setVisible(chars().slice(0, revealed).join(""))
  }

  createEffect(
    on([source, enabled], () => {
      if (!enabled()) {
        stop()
        revealed = chars().length
        carry = 0
        setVisible(source())
        mark(false)
        return
      }

      const target = chars().length
      // Source was replaced (not just appended): restart the reveal.
      if (revealed > target || !source().startsWith(chars().slice(0, revealed).join(""))) {
        revealed = 0
        carry = 0
      }
      tailStep = undefined

      if (revealed >= target) {
        stop()
        setVisible(source())
        mark(false)
        return
      }

      setVisible(chars().slice(0, revealed).join(""))
      mark(true)
      if (!timer) timer = setInterval(tick, frameMs)
    }),
  )

  return { text: visible, pending, finish }
}

// Fade a surface in on mount. Returns 1 immediately when disabled.
export function createAppear(enabled: Accessor<boolean>, duration = 1200): Accessor<number> {
  const [alpha, setAlpha] = createSignal(1)
  let started = false

  createEffect(() => {
    if (!enabled()) {
      started = false
      setAlpha(1)
      return
    }
    if (started) return
    started = true
    setAlpha(0)

    const start = performance.now()
    const timer = setInterval(() => {
      const progress = Math.min((performance.now() - start) / duration, 1)
      setAlpha(progress * progress * (3 - 2 * progress))
      if (progress >= 1) clearInterval(timer)
    }, defaultOptions.frameMs)

    onCleanup(() => clearInterval(timer))
  })

  return alpha
}
