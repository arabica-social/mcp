export function log(event: string, details: Record<string, unknown> = {}) {
  process.stderr.write(JSON.stringify({ event, ...details }) + "\n");
}
