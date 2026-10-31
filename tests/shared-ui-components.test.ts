import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("DataTable accessibility", () => {
  it("labels pagination controls and sortable headers", () => {
    const pagination = readFileSync(
      "components/shared/dataTable/DataTablePagination.tsx",
      "utf8",
    );
    expect(pagination).toContain('aria-label="Previous page"');
    expect(pagination).toContain('aria-label="Next page"');

    const table = readFileSync("components/shared/dataTable/DataTable.tsx", "utf8");
    expect(table).toContain('type="button"');
    expect(table).toContain("aria-sort");
  });

  it("renders link actions with Button render prop instead of nesting", () => {
    const actions = readFileSync(
      "components/shared/dataTable/DataTableActionsCell.tsx",
      "utf8",
    );
    expect(actions).toContain("render={<a href={href(row)} />}");
  });
});

describe("Markdown memo", () => {
  it("does not use a custom props comparator", () => {
    const source = readFileSync("components/shared/Markdown.tsx", "utf8");
    expect(source).not.toMatch(/React\.memo\([\s\S]*,\s*\(/);
  });
});
