import { spawn } from "node:child_process";

type Spawn = typeof spawn;

/**
 * Ask the operating system to open a URL in the user's default browser.
 *
 * BROWSER is honored first so headless/development environments can provide
 * their own launcher. If that launcher is unavailable, fall back to the
 * platform default. The URL is always passed as an argument, never through a
 * shell command string.
 */
export async function openBrowser(
  url: string,
  env = process.env,
  platform: NodeJS.Platform = process.platform,
  spawnCommand: Spawn = spawn,
): Promise<boolean> {
  const launchers: Array<{ command: string; args: string[] }> = [];

  if (env.BROWSER?.trim()) {
    launchers.push({ command: env.BROWSER.trim(), args: [url] });
  }

  if (platform === "darwin") {
    launchers.push({ command: "open", args: [url] });
  } else if (platform === "win32") {
    // The empty title is required by `start` when the first argument is a URL.
    launchers.push({
      command: "cmd.exe",
      args: ["/c", "start", "", url],
    });
  } else {
    launchers.push({ command: "xdg-open", args: [url] });
  }

  for (const launcher of launchers) {
    if (await launch(launcher.command, launcher.args, spawnCommand))
      return true;
  }
  return false;
}

function launch(command: string, args: string[], spawnCommand: Spawn) {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawnCommand(command, args, {
        detached: true,
        stdio: "ignore",
      });
      // An unavailable command fails asynchronously. Let the caller try the
      // platform launcher before falling back to a manually opened URL.
      child.once("error", () => resolve(false));
      child.once("spawn", () => resolve(true));
      child.unref();
    } catch {
      resolve(false);
    }
  });
}
