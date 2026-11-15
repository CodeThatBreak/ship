import { describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { GraphService } from "./graphService";

describe("GraphService.resolve", () => {
  const service = new GraphService();

  it("returns 404 for an unknown template id (CR-172)", async () => {
    await expect(
      service.resolve({ flowId: null, templateId: "tpl_does_not_exist" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("returns 404 for an unknown flow id (CR-172)", async () => {
    await expect(
      service.resolve({ flowId: "flow_does_not_exist", templateId: null }),
    ).rejects.toThrow(NotFoundError);
  });
});
