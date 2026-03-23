import { createServer } from "node:http";
import { handleAffordabilityApiRequest } from "./affordabilityApi.js";

const port = Number(process.env.PORT || 3030);

const server = createServer(async (req, res) => {
  try {
    const handled = await handleAffordabilityApiRequest(req, res);

    if (!handled) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Route not found." }));
    }
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected server error.",
      }),
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Affordability API bridge listening on http://127.0.0.1:${port}`);
  console.log("MCP mode will auto-connect over stdio when requests arrive.");
});
