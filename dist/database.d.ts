import { DatabaseSync } from "node:sqlite";
export type Database = DatabaseSync;
export declare function openDatabase(path: string): Database;
