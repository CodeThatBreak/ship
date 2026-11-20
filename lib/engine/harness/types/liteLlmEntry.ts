/** LiteLLM pricing entry — the fields DevFlow maps onto a rate card. */
export interface LiteLLMEntry {
  mode?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_write_input_token_cost?: number;
}
