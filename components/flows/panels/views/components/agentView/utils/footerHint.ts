import { FOOTER_HINT_BY_STATUS, NO_FOOTER_HINT } from '../constants/footerHint';

/** A status with no hint is expected (running, idle) and simply renders none. */
export const footerHintFor = (status: string): string =>
  FOOTER_HINT_BY_STATUS[status] ?? NO_FOOTER_HINT;
