import assert from "node:assert/strict";
import test from "node:test";
import { safeMediaMotionTransform } from "./MediaSurface.js";

test("horizontal pan never exceeds the image overscan", () => {
  for (const kind of ["pan-left", "pan-right"] as const) {
    for (const strength of [0, 0.5, 1]) {
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const width = 1920;
        const transform = safeMediaMotionTransform(kind, strength, progress, width);
        const availableOverscan = (transform.scale - 1) * width / 2;
        assert.ok(Math.abs(transform.translateX) < availableOverscan);
      }
    }
  }
});

test("static mode does not move or scale an image", () => {
  assert.deepEqual(safeMediaMotionTransform("static", 1, 0.5, 1920), { scale: 1, translateX: 0 });
});
