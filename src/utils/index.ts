export * from "./address.ts";
export * from "./codec.ts";
export * from "./oracle.ts";
export * from "./routes.ts";
export * from "./tokens.ts";

export function same(x: string, y: string): boolean {
  return x.toLowerCase() === y.toLowerCase();
}
