import { defineConfig } from "vite";

const GITHUB_PAGES_BASE = "/student-reality-lab-Byfield/";

function affordabilityApiPlugin() {
  const attachMiddleware = async (server) => {
    const { handleAffordabilityApiRequest } = await import("./server/affordabilityApi.js");

    server.middlewares.use(async (req, res, next) => {
      try {
        const handled = await handleAffordabilityApiRequest(req, res);
        if (!handled) {
          next();
        }
      } catch (error) {
        console.error(error);

        if (!res.writableEnded) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "Internal affordability API error." }));
        }
      }
    });
  };

  return {
    name: "affordability-api-plugin",
    apply: "serve",
    configureServer: attachMiddleware,
    configurePreviewServer: attachMiddleware,
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? GITHUB_PAGES_BASE : "/",
  plugins: [affordabilityApiPlugin()],
}));