import { defineConfig } from "vite";
import { handleAffordabilityApiRequest } from "./server/affordabilityApi.js";

const GITHUB_PAGES_BASE = "/student-reality-lab-Byfield/";

function affordabilityApiPlugin() {
  const attachMiddleware = (server) => {
    server.middlewares.use((req, res, next) => {
      handleAffordabilityApiRequest(req, res)
        .then((handled) => {
          if (!handled) {
            next();
          }
        })
        .catch((error) => {
          console.error(error);

          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "Internal affordability API error." }));
          }
        });
    });
  };

  return {
    name: "affordability-api-plugin",
    configureServer: attachMiddleware,
    configurePreviewServer: attachMiddleware,
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? GITHUB_PAGES_BASE : "/",
  plugins: [affordabilityApiPlugin()],
}));