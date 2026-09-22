import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createAppear, createRevealText, finishReveals, revealStep } from "../../src/util/reveal"

describe("util.reveal", () => {
  describe("revealStep", () => {
    test("does nothing when there is no backlog", () => {
      expect(revealStep(0.5, 0)).toEqual({ step: 0, carry: 0.5 })
      expect(revealStep(0.9, -4)).toEqual({ step: 0, carry: 0.9 })
    })

    test("accumulates a fractional rate so the average matches cps", () => {
      let carry = 0
      let total = 0
      for (let i = 0; i < 100; i++) {
        const next = revealStep(carry, 1000, { cps: 40, frameMs: 16 })
        carry = next.carry
        total += next.step
      }
      // 40 cps * 16ms * 100 frames = 64 code points.
      expect(total).toBe(64)
    })

    test("never reveals more than the backlog", () => {
      expect(revealStep(0, 1, { cps: 400, frameMs: 16 })).toEqual({ step: 1, carry: 5.4 })
    })

    test("honours a custom rate", () => {
      let carry = 0
      let total = 0
      for (let i = 0; i < 10; i++) {
        const next = revealStep(carry, 100, { cps: 100, frameMs: 10 })
        carry = next.carry
        total += next.step
      }
      // 100 cps * 10ms * 10 frames = 10 code points.
      expect(total).toBe(10)
    })

    test("reads a function rate each step", () => {
      let cps = 100
      const options = { cps: () => cps, frameMs: 10 }
      expect(revealStep(0, 100, options)).toEqual({ step: 1, carry: 0 })
      cps = 50
      expect(revealStep(0, 100, options)).toEqual({ step: 0, carry: 0.5 })
    })
  })

  describe("createRevealText", () => {
    test("passes the source through untouched when disabled", () => {
      createRoot((dispose) => {
        const [source] = createSignal("already complete")
        const reveal = createRevealText(source, () => false)
        expect(reveal.text()).toBe("already complete")
        expect(reveal.pending()).toBe(false)
        dispose()
      })
    })

    test("starts empty and eventually reveals the full source when enabled", async () => {
      await new Promise<void>((resolve) => {
        createRoot((dispose) => {
          const [source, setSource] = createSignal("")
          const reveal = createRevealText(source, () => true)
          setSource("hello world")
          expect(reveal.text()).toBe("")
          setTimeout(() => {
            expect(reveal.text()).toBe("hello world")
            expect(reveal.pending()).toBe(false)
            dispose()
            resolve()
          }, 900)
        })
      })
    })

    test("finish() completes the current reveal immediately", () => {
      createRoot((dispose) => {
        const [source] = createSignal("some long streamed text")
        const reveal = createRevealText(source, () => true)
        reveal.finish()
        expect(reveal.text()).toBe("some long streamed text")
        expect(reveal.pending()).toBe(false)
        dispose()
      })
    })

    test("drains the tail quickly once the source is final", async () => {
      await new Promise<void>((resolve) => {
        createRoot((dispose) => {
          const [source, setSource] = createSignal("")
          const reveal = createRevealText(source, () => true, { final: () => true, tailMs: 80 })
          setSource("x".repeat(2000))
          setTimeout(() => {
            expect(reveal.text().length).toBe(2000)
            expect(reveal.pending()).toBe(false)
            dispose()
            resolve()
          }, 300)
        })
      })
    })

    test("drains when final flips true mid-reveal", async () => {
      await new Promise<void>((resolve) => {
        createRoot((dispose) => {
          const [source] = createSignal("y".repeat(400))
          const [done, setDone] = createSignal(false)
          const reveal = createRevealText(source, () => true, { final: done, tailMs: 80 })
          setTimeout(() => setDone(true), 50)
          setTimeout(() => {
            expect(reveal.text().length).toBe(400)
            expect(reveal.pending()).toBe(false)
            dispose()
            resolve()
          }, 300)
        })
      })
    })

    test("finishReveals() completes active reveals immediately", () => {
      createRoot((dispose) => {
        const [source] = createSignal("z".repeat(500))
        const reveal = createRevealText(source, () => true)
        finishReveals()
        expect(reveal.text()).toBe("z".repeat(500))
        expect(reveal.pending()).toBe(false)
        dispose()
      })
    })
  })

  describe("createAppear", () => {
    test("is fully visible when disabled", () => {
      createRoot((dispose) => {
        const appear = createAppear(() => false)
        expect(appear()).toBe(1)
        dispose()
      })
    })
  })
})
