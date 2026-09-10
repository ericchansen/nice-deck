import { joinSession } from "@github/copilot-sdk/extension";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeckDesignExtension } from "./definition.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
await joinSession(createDeckDesignExtension({ repoRoot }));
