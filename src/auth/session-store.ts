import {
  readFile,
  writeFile,
  rename,
  unlink,
  mkdir,
  chmod,
} from "node:fs/promises";
import { dirname } from "node:path";

export class JsonStore<T = unknown> {
  constructor(private readonly path: string) {}

  private async read(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (e: any) {
      if (e.code === "ENOENT") return {};
      throw e;
    }
  }

  async get(key: string): Promise<T | undefined> {
    return (await this.read())[key] as T | undefined;
  }

  async set(key: string, value: T): Promise<void> {
    const d = dirname(this.path);
    await mkdir(d, { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(
      tmp,
      JSON.stringify({ ...(await this.read()), [key]: value }, null, 2),
      { mode: 0o600 },
    );
    await chmod(tmp, 0o600);
    await rename(tmp, this.path);
    await chmod(this.path, 0o600);
  }

  async del(key: string) {
    const all = await this.read();
    delete all[key];
    const tmp = `${this.path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async clear() {
    try {
      await unlink(this.path);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
