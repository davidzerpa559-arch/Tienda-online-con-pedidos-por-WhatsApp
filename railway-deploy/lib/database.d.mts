import type Database from "better-sqlite3";

export function openDatabase(filePath?: string): Database.Database;
