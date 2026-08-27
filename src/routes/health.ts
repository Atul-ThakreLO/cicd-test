import { Elysia } from "elysia";

export const healthRoutes = new Elysia({ prefix: "/health" }).get("/", () => ({
  status: "ok v2 is deployed on ec2, cicd is working properlly",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));
