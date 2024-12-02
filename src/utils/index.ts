export * from "./address";
export * from "./codec";
export * from "./oracle";
export * from "./routes";
export * from "./tokens";

export function same(x: string, y: string): boolean {
  return x.toLowerCase() === y.toLowerCase();
}
