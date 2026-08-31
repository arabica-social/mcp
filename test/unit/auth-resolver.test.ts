import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the NodeOAuthClient constructor options so the resolver choice can
// be asserted without reaching into the SDK's internal resolver classes. The
// real constructor validates metadata and performs network resolution, which
// is out of scope for this unit.
const { NodeOAuthClient } = vi.hoisted(() => ({
  NodeOAuthClient: vi.fn(function (
    this: { options: unknown },
    options: unknown,
  ) {
    this.options = options;
  }),
}));

vi.mock("@atproto/oauth-client-node", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@atproto/oauth-client-node")>();
  return { ...mod, NodeOAuthClient };
});

import { createOAuthClient } from "../../src/auth/client.js";

const lastOptions = () =>
  NodeOAuthClient.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

describe("createOAuthClient handle resolver", () => {
  const saved = process.env.ARABICA_HANDLE_RESOLVER;

  afterEach(() => {
    if (saved === undefined) delete process.env.ARABICA_HANDLE_RESOLVER;
    else process.env.ARABICA_HANDLE_RESOLVER = saved;
  });

  it("defaults to the Bluesky app-view resolver", () => {
    delete process.env.ARABICA_HANDLE_RESOLVER;
    createOAuthClient("/tmp/resolver-state.json", "/tmp/resolver-session.json");
    expect(lastOptions()?.handleResolver).toBe("https://bsky.social");
  });

  it("honors ARABICA_HANDLE_RESOLVER for users on other PDSs", () => {
    process.env.ARABICA_HANDLE_RESOLVER = "https://appview.example";
    createOAuthClient("/tmp/resolver-state.json", "/tmp/resolver-session.json");
    expect(lastOptions()?.handleResolver).toBe("https://appview.example");
  });

  it("lets an explicit option win over the environment", () => {
    process.env.ARABICA_HANDLE_RESOLVER = "https://appview.example";
    createOAuthClient(
      "/tmp/resolver-state.json",
      "/tmp/resolver-session.json",
      { handleResolver: "https://resolver.example" },
    );
    expect(lastOptions()?.handleResolver).toBe("https://resolver.example");
  });
});
