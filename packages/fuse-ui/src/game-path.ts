/** Public page path; stable game IDs and asset directories keep their original names. */
export function gamePagePath(id: string): string {
  return `${id.replaceAll("-", "")}/`;
}
