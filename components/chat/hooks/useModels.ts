import { useModelCatalog } from "./useModelCatalog";

/**
 * Back-compat export (the settings area still imports it from the chat barrel):
 * the catalog payload itself — undefined until loaded.
 */
export const useModels = () => useModelCatalog().data;
