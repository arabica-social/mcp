import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  listBeans,
  addBean,
  logBrew,
  editBrew,
  editBean,
  listBrews,
  Deps,
} from "./tools/operations.js";
import { successResult, failureResult, mapError } from "./tools/errors.js";
import {
  createCatalog,
  editCatalog,
  listCatalog,
} from "./tools/catalog-operations.js";
import type { CatalogKind } from "./records/catalog.js";

const out = z.object({ ok: z.boolean() }).passthrough();
const requestId = z.string().min(1).max(200);
const finite = z.number().finite();
const optionalText = (max: number) => z.string().max(max).optional();
/** Edit-only: optional fields accept null to clear them (delete semantics). */
const editableText = (max: number) => z.string().max(max).nullable().optional();
const catalogText = (max: number) => z.string().max(max).nullable().optional();
const catalogUri = catalogText(500);

const catalogKinds: CatalogKind[] = [
  "roaster",
  "grinder",
  "brewer",
  "recipe",
  "comment",
  "like",
];

const catalogPlural = (kind: CatalogKind) =>
  kind === "recipe" ? "recipes" : `${kind}s`;

/** Fields the lexicons require, so null cannot clear them. */
const catalogUnclearable: Record<CatalogKind, string> = {
  roaster: "name",
  grinder: "name",
  brewer: "name",
  recipe: "name",
  comment: "subject and text",
  like: "subject",
};
const catalogCreateSchemas: Record<
  CatalogKind,
  Record<string, z.ZodTypeAny>
> = {
  roaster: {
    name: z.string().max(200),
    location: optionalText(200),
    website: optionalText(500),
    sourceRef: catalogUri,
  },
  grinder: {
    name: z.string().max(200),
    grinderType: z.enum(["hand", "electric", "portable_electric"]).optional(),
    burrType: z.enum(["conical", "flat", "blade", ""]).optional(),
    notes: optionalText(1000),
    link: optionalText(500),
    sourceRef: catalogUri,
  },
  brewer: {
    name: z.string().max(200),
    brewerType: optionalText(100),
    description: optionalText(1000),
    link: optionalText(500),
    sourceRef: catalogUri,
  },
  recipe: {
    name: z.string().max(200),
    brewerRef: catalogUri,
    brewerType: optionalText(100),
    coffeeAmount: finite.min(0).optional(),
    waterAmount: finite.min(0).optional(),
    pours: z
      .array(
        z.object({
          waterAmount: finite.min(0),
          timeSeconds: finite.min(0),
        }),
      )
      .max(100)
      .optional(),
    notes: optionalText(2000),
    sourceRef: catalogUri,
  },
  comment: {
    subjectUri: z.string().max(500),
    subjectCid: z.string().max(200),
    text: z.string().max(1000),
    parentUri: catalogUri,
    parentCid: catalogText(200),
  },
  like: {
    subjectUri: z.string().max(500),
    subjectCid: z.string().max(200),
  },
};

const catalogEditSchemas: Record<CatalogKind, Record<string, z.ZodTypeAny>> = {
  roaster: {
    name: catalogText(200),
    location: catalogText(200),
    website: catalogText(500),
    sourceRef: catalogUri,
  },
  grinder: {
    name: catalogText(200),
    grinderType: z
      .enum(["hand", "electric", "portable_electric"])
      .nullable()
      .optional(),
    burrType: z.enum(["conical", "flat", "blade", ""]).nullable().optional(),
    notes: catalogText(1000),
    link: catalogText(500),
    sourceRef: catalogUri,
  },
  brewer: {
    name: catalogText(200),
    brewerType: catalogText(100),
    description: catalogText(1000),
    link: catalogText(500),
    sourceRef: catalogUri,
  },
  recipe: {
    name: catalogText(200),
    brewerRef: catalogUri,
    brewerType: catalogText(100),
    coffeeAmount: finite.min(0).nullable().optional(),
    waterAmount: finite.min(0).nullable().optional(),
    pours: z
      .array(
        z.object({
          waterAmount: finite.min(0),
          timeSeconds: finite.min(0),
        }),
      )
      .max(100)
      .nullable()
      .optional(),
    notes: catalogText(2000),
    sourceRef: catalogUri,
  },
  comment: {
    subjectUri: catalogUri,
    subjectCid: catalogText(200),
    text: catalogText(1000),
    parentUri: catalogUri,
    parentCid: catalogText(200),
  },
  like: { subjectUri: catalogUri, subjectCid: catalogText(200) },
};

export function createServer(deps: Deps) {
  const server = new McpServer({ name: "arabica-mcp", version: "0.1.0" });
  const tool =
    (
      summary: string | ((data: Record<string, unknown>) => string),
      fn: (input: any, extra: any) => Promise<Record<string, unknown>>,
    ) =>
    async (input: any, extra: any) => {
      try {
        const data = await fn(input, extra);
        return successResult(
          data,
          typeof summary === "function" ? summary(data) : summary,
        );
      } catch (e) {
        return failureResult(mapError(e));
      }
    };

  server.registerTool(
    "arabica_list_beans",
    {
      title: "List Arabica beans",
      description:
        "List beans owned by the authenticated user. Use the exact URI returned when logging a brew. Records that fail lexicon validation are returned in a malformed list with each validation error and the raw record, and can be repaired with arabica_edit_bean.",
      inputSchema: {
        query: optionalText(200),
        includeClosed: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: optionalText(500),
      },
      outputSchema: out,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    tool("Listed Arabica beans.", (input, extra) =>
      listBeans(input, deps, extra.signal),
    ),
  );
  server.registerTool(
    "arabica_add_bean",
    {
      title: "Add Arabica bean",
      description:
        "Create one bean in the authenticated user’s PDS. If a roaster is known, pass its exact AT-URI. When logging a brew for a bean without one, ask the user, use the roaster list, attach it with arabica_edit_bean, and retry. requestId must remain stable across retries.",
      inputSchema: {
        requestId,
        name: z.string().min(1).max(200),
        origin: optionalText(200),
        variety: optionalText(200),
        roastLevel: optionalText(100),
        roastDate: optionalText(10),
        process: optionalText(100),
        description: optionalText(5000),
        notes: optionalText(2000),
        link: optionalText(500),
        roasterRef: z.string().max(500).optional(),
        rating: z.number().int().min(1).max(10).optional(),
        closed: z.boolean().optional(),
        createdAt: optionalText(100),
      },
      outputSchema: out,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    tool("Created an Arabica bean.", (input, extra) =>
      addBean(input, deps, extra.signal),
    ),
  );
  server.registerTool(
    "arabica_log_brew",
    {
      title: "Log Arabica brew",
      description:
        "Create one brew for an exact bean AT-URI owned by the authenticated user. Use tastingNotes for free-form description or notes; brews do not have a separate description field.",
      inputSchema: {
        requestId,
        beanUri: z.string(),
        createdAt: optionalText(100),
        method: optionalText(100),
        temperature: finite.min(0).max(212).optional(),
        waterAmount: finite.min(0).optional(),
        coffeeAmount: finite.min(0).optional(),
        timeSeconds: finite.min(0).optional(),
        grindSize: optionalText(50),
        grinderRef: optionalText(500),
        tastingNotes: optionalText(2000),
        rating: z.number().int().min(1).max(10).optional(),
        pours: z
          .array(
            z.object({
              waterAmount: finite.min(0),
              timeSeconds: finite.min(0),
            }),
          )
          .max(100)
          .optional(),
        espresso: z
          .object({
            yieldWeight: finite.min(0).optional(),
            pressure: finite.min(0).optional(),
            preInfusionSeconds: finite.min(0).optional(),
          })
          .optional(),
        pourover: z
          .object({
            bloomWater: finite.min(0).optional(),
            bloomSeconds: finite.min(0).optional(),
            drawdownSeconds: finite.min(0).optional(),
            bypassWater: finite.min(0).optional(),
            filter: optionalText(100),
          })
          .optional(),
      },
      outputSchema: out,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    tool("Logged an Arabica brew.", (input, extra) =>
      logBrew(input, deps, extra.signal),
    ),
  );
  server.registerTool(
    "arabica_edit_brew",
    {
      title: "Edit Arabica brew",
      description:
        "Update an existing brew at its exact AT-URI. This uses putRecord and never creates a new record. Supply only fields to change; pass null to clear any optional field (method, temperature, waterAmount, coffeeAmount, timeSeconds, grindSize, grinderRef, tastingNotes, rating, pours, espresso, pourover). createdAt can be updated but not cleared; beanRef cannot be changed. Use tastingNotes for free-form description or notes; brews do not have a separate description field. grinderRef is the grinder record URI, while grindSize is the separate grind setting; ask for grindSize if it was not provided. A record that fails lexicon validation can be repaired here: supply corrected fields; the merged record must validate.",
      inputSchema: {
        requestId,
        brewUri: z.string(),
        createdAt: optionalText(100),
        method: editableText(100),
        temperature: finite.min(0).max(212).nullable().optional(),
        waterAmount: finite.min(0).nullable().optional(),
        coffeeAmount: finite.min(0).nullable().optional(),
        timeSeconds: finite.min(0).nullable().optional(),
        grindSize: editableText(50),
        grinderRef: editableText(500),
        tastingNotes: editableText(2000),
        rating: z.number().int().min(1).max(10).nullable().optional(),
        pours: z
          .array(
            z.object({
              waterAmount: finite.min(0),
              timeSeconds: finite.min(0),
            }),
          )
          .max(100)
          .nullable()
          .optional(),
        espresso: z
          .object({
            yieldWeight: finite.min(0).optional(),
            pressure: finite.min(0).optional(),
            preInfusionSeconds: finite.min(0).optional(),
          })
          .nullable()
          .optional(),
        pourover: z
          .object({
            bloomWater: finite.min(0).optional(),
            bloomSeconds: finite.min(0).optional(),
            drawdownSeconds: finite.min(0).optional(),
            bypassWater: finite.min(0).optional(),
            filter: optionalText(100),
          })
          .nullable()
          .optional(),
      },
      outputSchema: out,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    tool("Updated an Arabica brew.", (input, extra) =>
      editBrew(input, deps, extra.signal),
    ),
  );
  server.registerTool(
    "arabica_list_brews",
    {
      title: "List Arabica brews",
      description:
        "List brews owned by the authenticated user. Records that fail lexicon validation are returned in a malformed list with each validation error and the raw record, and can be repaired with arabica_edit_brew.",
      inputSchema: {
        query: optionalText(200),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: optionalText(500),
      },
      outputSchema: out,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    tool("Listed Arabica brews.", (input, extra) =>
      listBrews(input, deps, extra.signal),
    ),
  );
  server.registerTool(
    "arabica_edit_bean",
    {
      title: "Edit Arabica bean",
      description:
        "Update an existing bean at its exact beanUri with putRecord. Use roasterRef to attach a roaster. Pass null to clear any optional field (origin, variety, roastLevel, roastDate, process, description, notes, link, roasterRef, rating, closed). name and createdAt cannot be cleared. A record that fails lexicon validation can be repaired here: supply corrected fields; the merged record must validate.",
      inputSchema: {
        requestId,
        beanUri: z.string(),
        name: z.string().min(1).max(200).optional(),
        origin: editableText(200),
        variety: editableText(200),
        roastLevel: editableText(100),
        roastDate: editableText(10),
        process: editableText(100),
        description: editableText(5000),
        notes: editableText(2000),
        link: editableText(500),
        roasterRef: z.string().max(500).nullable().optional(),
        rating: z.number().int().min(1).max(10).nullable().optional(),
        closed: z.boolean().nullable().optional(),
        createdAt: optionalText(100),
      },
      outputSchema: out,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    tool("Updated an Arabica bean.", (input, extra) =>
      editBean(input, deps, extra.signal),
    ),
  );
  for (const kind of catalogKinds) {
    const plural = catalogPlural(kind);
    server.registerTool(
      `arabica_list_${plural}`,
      {
        title: `List Arabica ${plural}`,
        description: `List ${plural} owned by the authenticated user. Use an exact URI returned by this tool when referencing a record. Records that fail lexicon validation are returned in a malformed list with each validation error and the raw record, and can be repaired with arabica_edit_${kind}.`,
        inputSchema: {
          query: optionalText(200),
          limit: z.number().int().min(1).max(100).optional(),
          cursor: optionalText(500),
        },
        outputSchema: out,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      tool(`Listed Arabica ${plural}.`, (input, extra) =>
        listCatalog(kind, input, deps, extra.signal),
      ),
    );
    server.registerTool(
      `arabica_create_${kind}`,
      {
        title: `Create Arabica ${kind}`,
        description: `Create one ${kind} record in the authenticated user's PDS. requestId must remain stable across retries.`,
        inputSchema: {
          requestId,
          createdAt: optionalText(100),
          ...catalogCreateSchemas[kind],
        },
        outputSchema: out,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      tool(`Created an Arabica ${kind}.`, (input, extra) =>
        createCatalog(kind, input, deps, extra.signal),
      ),
    );
    server.registerTool(
      `arabica_edit_${kind}`,
      {
        title: `Edit Arabica ${kind}`,
        description: `Update an existing ${kind} at its exact recordUri with putRecord. Supply only fields to change; pass null to clear optional fields. ${catalogUnclearable[kind]} cannot be cleared. A record that fails lexicon validation can be repaired here: supply corrected fields; the merged record must validate.`,
        inputSchema: {
          requestId,
          recordUri: z.string(),
          ...catalogEditSchemas[kind],
        },
        outputSchema: out,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      tool(`Updated an Arabica ${kind}.`, (input, extra) =>
        editCatalog(kind, input, deps, extra.signal),
      ),
    );
  }
  return server;
}

export async function serve(deps: Deps) {
  const server = createServer(deps);
  const transport = new StdioServerTransport();
  transport.onerror = (e) =>
    console.error(
      JSON.stringify({ event: "mcp_transport_error", message: e.message }),
    );
  transport.onclose = () =>
    console.error(JSON.stringify({ event: "mcp_closed" }));
  await server.connect(transport);
  return server;
}
