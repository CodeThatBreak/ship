import "server-only";

export const sampleValue = (type: unknown): unknown => {
  switch (type) {
    case "number":
      return 0;
    case "boolean":
      return true;
    case "object":
      return {};
    case "array":
      return [];
    default:
      return "";
  }
};
