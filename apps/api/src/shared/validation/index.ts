import { z } from "zod";

export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.flatten();
    const error = new Error("Validation failed") as Error & {
      code: string;
      details: unknown;
      statusCode: number;
    };
    error.code = "VALIDATION_ERROR";
    error.details = details;
    error.statusCode = 400;
    throw error;
  }
  return result.data;
}
