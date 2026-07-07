import { createHonoServer } from "react-router-hono-server/bun";

const server = await createHonoServer({
  defaultLogger: false,
});
export default server;
