/** „Lisa", „Lisa und Tom", „Lisa, Tom und Max" */
export function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}
