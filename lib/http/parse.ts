import "server-only";

import { z } from "zod";
import { ValidationError } from "../errors";

const formatZodError = (error: z.ZodError): string => {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
};

export const parseJson = async <T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error));
  }
  return result.data;
};

export const parseQuery = <T extends z.ZodType>(
  url: URL,
  schema: T,
): z.infer<T> => {
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error));
  }
  return result.data;
};
