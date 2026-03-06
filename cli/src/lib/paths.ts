import { homedir } from "node:os";
import { join } from "node:path";

const HUSK_HOME = join(homedir(), ".husk");

export const paths = {
	home: HUSK_HOME,
	server: join(HUSK_HOME, "server"),
	data: join(HUSK_HOME, "data"),
	config: join(HUSK_HOME, "husk.toml"),
	credentials: join(HUSK_HOME, "credentials.json"),
	log: join(HUSK_HOME, "husk.log"),
	pid: join(HUSK_HOME, "husk.pid"),
	version: join(HUSK_HOME, "version.json"),
	modelsPath: join(HUSK_HOME, "data", "models"),
	dbPath: join(HUSK_HOME, "data", "husk.db"),
	vectorsPath: join(HUSK_HOME, "data", "husk-vectors.db"),

	// OS service paths
	launchdPlist: join(
		homedir(),
		"Library",
		"LaunchAgents",
		"io.husk.server.plist",
	),
	systemdUnit: join(
		homedir(),
		".config",
		"systemd",
		"user",
		"husk.service",
	),
};
