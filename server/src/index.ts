import { app } from "./app.js";
import { getUserCount, initDb } from "./db.js";
import { checkOllamaModel } from "./embeddings.js";
import { initQdrant } from "./qdrant.js";

initDb();

const port = Number(process.env.YAMS_PORT) || 3000;
const userCount = getUserCount();

console.log(`YAMS server starting on port ${port}`);
if (userCount === 0) {
	console.log("No users found — visit http://localhost:%d/setup to create an admin", port);
} else {
	console.log("Ready (%d user(s) configured)", userCount);
}

initQdrant()
	.then(() => console.log("Qdrant connected"))
	.catch((err) =>
		console.log("Qdrant not available — ingest will fail until it's running:", err.message),
	);

checkOllamaModel();

export default {
	port,
	fetch: app.fetch,
};
