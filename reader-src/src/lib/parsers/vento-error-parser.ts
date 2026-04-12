import type { VentoErrorCardProps } from "@/types";

/**
 * Convert an array of Vento error objects into placeholder-mapped entries
 * for the rendering pipeline. Each error gets a unique placeholder comment
 * that the pipeline will later replace with a rendered Vue component.
 */
export function extractVentoErrors(
  errors: VentoErrorCardProps[],
): Array<{ placeholder: string; data: VentoErrorCardProps }> {
  return errors.map((error, index) => ({
    placeholder: `<!--VENTO_ERROR_${index}-->`,
    data: error,
  }));
}
