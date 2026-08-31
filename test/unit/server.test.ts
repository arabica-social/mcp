import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BEAN_COLLECTION } from "../../src/generated/lexicons.js";
import { RepositoryError } from "../../src/pds/repository.js";
import { createServer } from "../../src/server.js";
import { IdempotencyStore } from "../../src/state/idempotency.js";
import type { Deps } from "../../src/tools/operations.js";

const DID = "did:plc:test";
const BEAN_URI = `at://${DID}/social.arabica.alpha.bean/3jzfcijpj2z2a`;
const ROASTER_URI = `at://${DID}/social.arabica.alpha.roaster/3jzfcijpj2z2a`;

const TID = "3jzfcijpj2z2a";
const wrap = (collection: string, value: Record<string, unknown>) => ({
  uri: `at://${DID}/${collection}/${TID}`,
  rkey: TID,
  value,
});
const beanRecord = (name: string, closed = false) =>
  wrap("social.arabica.alpha.bean", {
    $type: "social.arabica.alpha.bean",
    name,
    closed,
    createdAt: "2024-01-01T00:00:00.000Z",
  });
const brewRecord = (method: string) =>
  wrap("social.arabica.alpha.brew", {
    $type: "social.arabica.alpha.brew",
    beanRef: BEAN_URI,
    method,
    createdAt: "2024-01-01T00:00:00.000Z",
  });
const roasterRecord = (name: string) =>
  wrap("social.arabica.alpha.roaster", {
    $type: "social.arabica.alpha.roaster",
    name,
    createdAt: "2024-01-01T00:00:00.000Z",
  });

type ListRecordsStub = (
  collection: string,
  limit: number,
  cursor: string | undefined,
  signal: AbortSignal | undefined,
) => Promise<{ records: any[]; cursor?: string }>;

function depsWith(listRecords?: ListRecordsStub) {
  const list = vi.fn(listRecords ?? (async () => ({ records: [] as any[] })));
  const deps: Deps = {
    auth: {
      getSession: async () => ({
        did: DID,
        fetchHandler: async () => new Response(),
      }),
    },
    pds: () => ({
      did: DID,
      listRecords: list,
      getRecord: vi.fn(),
      createRecord: vi.fn(),
      putRecord: vi.fn(),
    }),
    idem: new IdempotencyStore(
      join(
        mkdtempSync(join(tmpdir(), "arabica-server-")),
        "idempotency.sqlite",
      ),
    ),
    clientId: "test",
  };
  return { deps, list };
}

function handler(server: ReturnType<typeof createServer>, name: string) {
  return (server as any)._registeredTools[name].handler;
}
function inputSchema(server: ReturnType<typeof createServer>, name: string) {
  return (server as any)._registeredTools[name].inputSchema;
}

describe("server tool wiring", () => {
  it("registers all bean, brew, auth, and catalog tools exactly once", () => {
    const { deps } = depsWith();
    const server = createServer(deps);
    const names = Object.keys((server as any)._registeredTools).sort();
    const kinds = ["roaster", "grinder", "brewer", "recipe", "comment", "like"];
    const plural = (kind: string) =>
      kind === "recipe" ? "recipes" : `${kind}s`;
    const expected = [
      "arabica_list_beans",
      "arabica_add_bean",
      "arabica_log_brew",
      "arabica_edit_brew",
      "arabica_list_brews",
      "arabica_edit_bean",
      ...kinds.flatMap((kind) => [
        `arabica_list_${plural(kind)}`,
        `arabica_create_${kind}`,
        `arabica_edit_${kind}`,
      ]),
    ].sort();
    expect(names).toEqual(expected);
  });

  it("surfaces a failing operation as a structured error result", async () => {
    const { deps } = depsWith(async () => {
      throw new RepositoryError("unavailable", "PDS unavailable");
    });
    const server = createServer(deps);
    const result = await handler(server, "arabica_list_beans")(
      {},
      { signal: new AbortController().signal },
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "pds_unavailable",
        message: "The PDS is unavailable. Try again later.",
        retryable: true,
      },
    });
    expect(result.content[0].text).toBe(
      "The PDS is unavailable. Try again later.",
    );
  });

  it("forwards the MCP cancellation signal into PDS calls", async () => {
    const { deps, list } = depsWith();
    const server = createServer(deps);
    const controller = new AbortController();
    const result = await handler(server, "arabica_list_beans")(
      { limit: 10 },
      { signal: controller.signal },
    );
    expect(list).toHaveBeenCalledWith(
      BEAN_COLLECTION,
      10,
      undefined,
      controller.signal,
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ ok: true });
  });

  it("accepts catalog tools with their dynamic descriptions", async () => {
    const { deps } = depsWith();
    const server = createServer(deps);
    const createRecipe = (server as any)._registeredTools[
      "arabica_create_recipe"
    ];
    expect(createRecipe.title).toBe("Create Arabica recipe");
    expect(createRecipe.description).toBe(
      "Create one recipe record in the authenticated user's PDS. requestId must remain stable across retries.",
    );
    expect((server as any)._registeredTools["arabica_list_recipes"].title).toBe(
      "List Arabica recipes",
    );
  });
});

describe("bean and brew input schemas match the record converters", () => {
  it("accepts brew fields as optional in arabica_log_brew", () => {
    const { deps } = depsWith();
    const server = createServer(deps);
    const schema = inputSchema(server, "arabica_log_brew");
    const minimal = schema.safeParse({ requestId: "r", beanUri: BEAN_URI });
    expect(minimal.success).toBe(true);
    const full = schema.safeParse({
      requestId: "r",
      beanUri: BEAN_URI,
      temperature: 93.5,
      waterAmount: 300,
      coffeeAmount: 18,
      timeSeconds: 180,
    });
    expect(full.success).toBe(true);
  });

  it("accepts brew fields as optional in arabica_edit_brew", () => {
    const { deps } = depsWith();
    const server = createServer(deps);
    const schema = inputSchema(server, "arabica_edit_brew");
    const minimal = schema.safeParse({ requestId: "r", brewUri: BEAN_URI });
    expect(minimal.success).toBe(true);
    const partial = schema.safeParse({
      requestId: "r",
      brewUri: BEAN_URI,
      temperature: 93.5,
    });
    expect(partial.success).toBe(true);
  });

  it("enforces a non-empty name up to 200 chars in arabica_add_bean", () => {
    const { deps } = depsWith();
    const server = createServer(deps);
    const schema = inputSchema(server, "arabica_add_bean");
    expect(schema.safeParse({ requestId: "r", name: "Bean" }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({ requestId: "r", name: "b".repeat(200) }).success,
    ).toBe(true);
    expect(schema.safeParse({ requestId: "r", name: "" }).success).toBe(false);
    expect(
      schema.safeParse({ requestId: "r", name: "b".repeat(201) }).success,
    ).toBe(false);
  });

  it("keeps name optional but non-empty in arabica_edit_bean", () => {
    const { deps } = depsWith();
    const server = createServer(deps);
    const schema = inputSchema(server, "arabica_edit_bean");
    expect(
      schema.safeParse({ requestId: "r", beanUri: BEAN_URI }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ requestId: "r", beanUri: BEAN_URI, name: "New" })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ requestId: "r", beanUri: BEAN_URI, name: "" }).success,
    ).toBe(false);
  });

  it("allows null to clear optional fields in edit schemas, never required ones", () => {
    const { deps } = depsWith();
    const server = createServer(deps);
    const beanSchema = inputSchema(server, "arabica_edit_bean");
    expect(
      beanSchema.safeParse({
        requestId: "r",
        beanUri: BEAN_URI,
        origin: null,
        notes: null,
        rating: null,
        closed: null,
      }).success,
    ).toBe(true);
    expect(
      beanSchema.safeParse({ requestId: "r", beanUri: BEAN_URI, name: null })
        .success,
    ).toBe(false);
    expect(
      beanSchema.safeParse({
        requestId: "r",
        beanUri: BEAN_URI,
        createdAt: null,
      }).success,
    ).toBe(false);
    const brewSchema = inputSchema(server, "arabica_edit_brew");
    expect(
      brewSchema.safeParse({
        requestId: "r",
        brewUri: BEAN_URI,
        method: null,
        grindSize: null,
        espresso: null,
        pourover: null,
        pours: null,
      }).success,
    ).toBe(true);
    expect(
      brewSchema.safeParse({
        requestId: "r",
        brewUri: BEAN_URI,
        createdAt: null,
      }).success,
    ).toBe(false);
  });

  it("reports clearing a required catalog name as invalid_input", async () => {
    const { deps } = depsWith();
    deps.pds = () => ({
      did: DID,
      listRecords: vi.fn(async () => ({ records: [] })),
      getRecord: vi.fn(async () => ({
        uri: ROASTER_URI,
        cid: "bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        rkey: "3jzfcijpj2z2a",
        value: roasterRecord("Black & White").value,
      })),
      createRecord: vi.fn(),
      putRecord: vi.fn(),
    });
    const server = createServer(deps);
    const result = await handler(server, "arabica_edit_roaster")(
      { requestId: "r", recordUri: ROASTER_URI, name: null },
      { signal: new AbortController().signal },
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: "name cannot be cleared" },
    });
  });
});

describe("filtered list searches auto-paginate", () => {
  it("finds a bean match on a later page instead of reporting an empty list", async () => {
    const { deps, list } = depsWith(async (_c, _l, cursor) =>
      cursor === "c1"
        ? { records: [beanRecord("Ethiopia Yirgacheffe")] }
        : { records: [beanRecord("Colombia")], cursor: "c1" },
    );
    const server = createServer(deps);
    const result = await handler(server, "arabica_list_beans")(
      { query: "ethiopia" },
      { signal: new AbortController().signal },
    );
    expect(result.structuredContent.beans).toHaveLength(1);
    expect(result.structuredContent.beans[0].record.name).toBe(
      "Ethiopia Yirgacheffe",
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(
      1,
      BEAN_COLLECTION,
      100,
      undefined,
      expect.anything(),
    );
    expect(list).toHaveBeenNthCalledWith(
      2,
      BEAN_COLLECTION,
      100,
      "c1",
      expect.anything(),
    );
  });

  it("paginates bean lists when includeClosed is set", async () => {
    const { deps, list } = depsWith(async (_c, _l, cursor) =>
      cursor === "c1"
        ? { records: [beanRecord("Panama", true)] }
        : {
            records: [beanRecord("Colombia"), beanRecord("Kenya", true)],
            cursor: "c1",
          },
    );
    const server = createServer(deps);
    const result = await handler(server, "arabica_list_beans")(
      { includeClosed: true },
      { signal: new AbortController().signal },
    );
    expect(
      result.structuredContent.beans.map((b: any) => b.record.name),
    ).toEqual(["Colombia", "Kenya", "Panama"]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("surfaces the scan bound when a search hits it with a cursor remaining", async () => {
    const { deps, list } = depsWith(async () => ({
      records: [beanRecord("Colombia")],
      cursor: "more",
    }));
    const server = createServer(deps);
    const result = await handler(server, "arabica_list_beans")(
      { query: "missing" },
      { signal: new AbortController().signal },
    );
    expect(result.structuredContent.beans).toHaveLength(0);
    expect(result.structuredContent.searchTruncated).toBe(true);
    expect(result.structuredContent.cursor).toBe("more");
    expect(list).toHaveBeenCalledTimes(5);
  });

  it("stops searching once enough matches are found", async () => {
    const { deps, list } = depsWith(async () => ({
      records: [beanRecord("Ethiopia"), beanRecord("Kenya")],
      cursor: "more",
    }));
    const server = createServer(deps);
    const result = await handler(server, "arabica_list_beans")(
      { query: "ethiopia", limit: 1 },
      { signal: new AbortController().signal },
    );
    expect(result.structuredContent.beans).toHaveLength(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("finds a brew match on a later page", async () => {
    const { deps, list } = depsWith(async (_c, _l, cursor) =>
      cursor === "c1"
        ? { records: [brewRecord("Espresso")] }
        : { records: [brewRecord("V60")], cursor: "c1" },
    );
    const server = createServer(deps);
    const result = await handler(server, "arabica_list_brews")(
      { query: "espresso" },
      { signal: new AbortController().signal },
    );
    expect(result.structuredContent.brews).toHaveLength(1);
    expect(result.structuredContent.brews[0].record.method).toBe("Espresso");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("finds a catalog record on a later page", async () => {
    const { deps, list } = depsWith(async (_c, _l, cursor) =>
      cursor === "c1"
        ? { records: [roasterRecord("Black & White")] }
        : { records: [roasterRecord("Red Rooster")], cursor: "c1" },
    );
    const server = createServer(deps);
    const result = await handler(server, "arabica_list_roasters")(
      { query: "black" },
      { signal: new AbortController().signal },
    );
    expect(result.structuredContent.roasters).toHaveLength(1);
    expect(result.structuredContent.roasters[0].record.name).toBe(
      "Black & White",
    );
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("does not auto-paginate unfiltered single-page lists", async () => {
    const { deps, list } = depsWith(async () => ({
      records: [beanRecord("Colombia")],
      cursor: "more",
    }));
    const server = createServer(deps);
    await handler(server, "arabica_list_beans")(
      {},
      { signal: new AbortController().signal },
    );
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(
      BEAN_COLLECTION,
      50,
      undefined,
      expect.anything(),
    );
  });
});
