import { Elysia } from "elysia";
import { healthRoutes } from "./routes/health";
import { userRoutes } from "./routes/users";

const app = new Elysia()
  .use(healthRoutes)
  .use(userRoutes)
  .listen(3000);

console.log(`🦊 Elysia server running at http://${app.server?.hostname}:${app.server?.port}`);

export type App = typeof app;
