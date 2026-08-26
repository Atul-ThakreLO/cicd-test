import { Elysia, t } from "elysia";

// In-memory store — good enough for CI/CD practice
const users: { id: number; name: string; email: string }[] = [
  { id: 1, name: "Alice", email: "alice@example.com" },
];
let nextId = 2;

export const userRoutes = new Elysia({ prefix: "/users" })
  .get("/", () => users)

  .get("/:id", ({ params, error }) => {
    const user = users.find((u) => u.id === Number(params.id));
    return user ?? error(404, { message: "User not found" });
  })

  .post(
    "/",
    ({ body }) => {
      const user = { id: nextId++, ...body };
      users.push(user);
      return user;
    },
    {
      body: t.Object({
        name: t.String(),
        email: t.String({ format: "email" }),
      }),
    }
  )

  .delete("/:id", ({ params, error }) => {
    const idx = users.findIndex((u) => u.id === Number(params.id));
    if (idx === -1) return error(404, { message: "User not found" });
    const [deleted] = users.splice(idx, 1);
    return { deleted };
  });
