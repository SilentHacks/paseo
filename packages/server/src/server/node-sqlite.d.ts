// Node 22 ships this module. The repo's Node 20 type package does not.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(filename: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    };
    close(): void;
  }
}
