-- Step 02 (decision Q5): the UI derives the active node from nodes.status;
-- the flows.current_node pointer is deleted.
ALTER TABLE "flows" DROP COLUMN "current_node";
