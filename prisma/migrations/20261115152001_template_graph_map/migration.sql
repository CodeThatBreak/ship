/*
  Warnings:

  - You are about to drop the column `templateGraph` on the `flows` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "flows" DROP COLUMN "templateGraph",
ADD COLUMN     "template_graph" JSONB;
