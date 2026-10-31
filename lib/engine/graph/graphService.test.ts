import { describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { GraphService } from "./graphService";

describe("GraphService.resolve", () => {
  const service = new GraphService();

  it("returns 404 for an unknown template id (CR-172)", () => {
    expect(() =>
      service.resolve({ flowId: null, templateId: "tpl_does_not_exist" }),
    ).toThrow(NotFoundError);
  });

  it("returns 404 for an unknown flow id (CR-172)", () => {
    expect(() =>
      service.resolve({ flowId: "flow_does_not_exist", templateId: null }),
    ).toThrow(NotFoundError);
  });
});
