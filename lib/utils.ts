import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className composition. */
export class Styles {
  /**
   * Merge conditional class values, resolving Tailwind conflicts
   * (last one wins for the same utility group).
   */
  cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
  }
}

export const styles = new Styles();

/** Convenience alias mirroring Styles.cn for component files. */
export const cn = styles.cn.bind(styles);
