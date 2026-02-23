import { app } from "./app.js";
import { getUserCount, initDb } from "./db.js";

initDb();

const port = Number(process.env.YAMS_PORT) || 3000;
const userCount = getUserCount();

console.log(`YAMS server starting on port ${port}`);
if (userCount === 0) {
	console.log("No users found — visit http://localhost:%d/setup to create an admin", port);
} else {
	console.log("Ready (%d user(s) configured)", userCount);
}

export default {
	port,
	fetch: app.fetch,
};
