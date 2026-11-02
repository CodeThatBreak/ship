import "server-only";

import { z } from "zod";

export const settingString = z.string();
export const settingBoolean = z.boolean();
export const settingNumber = z.number();
export const settingStringArray = z.array(z.string());
export const settingStringRecord = z.record(z.string(), z.string());
export const settingUnknownRecord = z.record(z.string(), z.unknown());

export const pricingTableSchema = z.record(
  z.string(),
  z.object({
    input_per_mtok: z.number().optional(),
    output_per_mtok: z.number().optional(),
    cache_read_per_mtok: z.number().optional(),
    cache_write_per_mtok: z.number().optional(),
  }),
);
