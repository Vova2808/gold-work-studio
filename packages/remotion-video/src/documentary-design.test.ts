import assert from "node:assert/strict";
import test from "node:test";
import { documentaryDesign } from "./documentary-design.js";

test("archive card hugs the original photo at every animation frame without inner letterboxing", () => {
  for (const template of ["archive", "archive-dark", "gallery"]) {
    for (const frame of [0, 30, 90]) {
      const design = documentaryDesign(template, frame, 100, "#ffffff", undefined, { width: 2004, height: 1350, canvasWidth: 1920, canvasHeight: 1080 });
      const border = template === "archive-dark" ? 6 : 32;
      assert.ok(Math.abs((Number(design.main.width) - border) / (Number(design.main.height) - border) - 2004 / 1350) < 1e-8);
      assert.ok(Number(design.main.width) < 1920 && Number(design.main.height) < 1080);
    }
  }
});
