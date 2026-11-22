import "dotenv/config";
import app from "./server.js";
import { config } from "./config.js";

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`HkTube Agent Backend listening on :${config.port}`);
});

const shutdown = (signal: string) => {
  console.log(`Received ${signal}; shutting down`);
  server.close(error => { if (error) { console.error(error); process.exitCode = 1; } });
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
