import "server-only";

import { db } from "../db";
import { processSingleton } from "../singleton";
import { SettingsService } from "./settings-service";

export const settingsService = processSingleton("settingsService", () => new SettingsService(db));

export { SettingsService } from "./settings-service";
