import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { openBrowser } from "../../src/auth/browser.js";

describe("browser launcher", () => {
  it("falls back to xdg-open when BROWSER is unavailable on Linux", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawn = ((command: string, args: string[]) => {
      calls.push({ command, args });
      const child = new EventEmitter() as EventEmitter & {
        unref: () => void;
      };
      child.unref = () => {};
      queueMicrotask(() => {
        if (command === "missing-browser")
          child.emit("error", new Error("ENOENT"));
        else child.emit("spawn");
      });
      return child;
    }) as never;

    await expect(
      openBrowser(
        "https://issuer.example/authorize",
        { BROWSER: "missing-browser" },
        "linux",
        spawn,
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      {
        command: "missing-browser",
        args: ["https://issuer.example/authorize"],
      },
      {
        command: "xdg-open",
        args: ["https://issuer.example/authorize"],
      },
    ]);
  });
});
