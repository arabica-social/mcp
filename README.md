# Arabica MCP

`@arabica/mcp` is a local, personal-use MCP server. It writes Arabica coffee records directly to the authenticated AT Protocol PDS. It does not use the Arabica web app or private APIs.

## Install and Configure

```sh
npm install -g @arabica/mcp
arabica-mcp login your-handle.example.com
```

`login` opens the authorization page automatically in the default browser. If it cannot find a browser, it prints the URL so you can open it manually.

Configure a stdio MCP client:

```json
{
  "mcpServers": {
    "arabica": {
      "command": "arabica-mcp",
      "args": ["serve"]
    }
  }
}
```

## Usage

Once you are logged in and the MCP is registered, your agent will be able to list, create, and edit your arabica.social records.

For example, you could use a model with vision capabilities to create a bean given a picture of the bag!

---

## Development

When working from this repository, log in and run the server directly from TypeScript:

```sh
npx tsx src/cli.ts login your-handle.example
npx tsx src/cli.ts status
npm run dev
```

`npm run dev` only starts the stdio MCP server; run the login command separately.
Use the same user and `XDG_DATA_HOME` for login and the server.

Configure your MCP client to launch
`npm run dev` from the repository directory, or use the built `arabica-mcp serve`
command.

The server provides bean and brew tools, plus list/create/edit tools for roasters, grinders, brewers, recipes, comments, and likes. Use `arabica_list_roasters` when a roaster is not known. Before logging a brew, select a bean and ensure it has a `roasterRef`; if it does not, ask the user, attach the roaster with `arabica_edit_bean`, then retry `arabica_log_brew`. Use exact AT-URIs returned by list tools. `arabica_edit_brew` updates an existing brew in place with `putRecord`. `grinderRef` identifies the grinder record, while `grindSize` is the separate setting. Brews have no separate description field; use `tastingNotes`. Keep the same opaque `requestId` when retrying a mutation.

## Lexicons

Record schemas come from the lexicons published on the AT Protocol network
(`social.arabica.alpha.*`). Pull the published schemas and regenerate the
TypeScript when you want to pick up upstream changes:

```sh
pnpm lexicons:update
```

Generation alone (from the checked-in `lexicons/` copies) is `pnpm generate`.
CI regenerates and fails if the committed output is stale.

OAuth state, session material, and idempotency data are stored below `${XDG_DATA_HOME:-~/.local/share}/arabica-mcp`. Session files are owner-only. Run `arabica-mcp status` to check the session and `arabica-mcp logout` to revoke it when possible and remove local data.
