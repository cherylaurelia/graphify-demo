import { target } from "./target.js";

export function makeApp() {
  register("/a", async (c) => { return target(c); });
}

declare function register(p: string, h: (c: number) => void): void;
