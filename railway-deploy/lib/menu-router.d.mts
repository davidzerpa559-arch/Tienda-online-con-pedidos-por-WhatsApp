import type Database from "better-sqlite3";
import type { IRouter, RequestHandler } from "express";

export function registerMenuApi(
  router: IRouter,
  db: Database.Database,
  imageUpload: RequestHandler,
  env?: NodeJS.ProcessEnv,
): IRouter;

export function readStoreSettings(db: Database.Database): {
  storeName: string;
  tagline: string;
  logoUrl: string | null;
  whatsappNumber: string;
  physicalAddress: string;
  bankName: string;
  bankId: string;
  bankPhone: string;
  isOpen: boolean;
  pickupEnabled: boolean;
  webhookUrl: string | null;
};

export function readPublicStore(db: Database.Database): Omit<ReturnType<typeof readStoreSettings>, "webhookUrl">;
export function readPublicProducts(db: Database.Database, availableOnly?: boolean): Array<{
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  price: number;
  offerPrice: number | null;
  isAvailable: boolean;
  likeCount: number;
  dislikeCount: number;
}>;
export function readProductBySlug(db: Database.Database, slug: string): ReturnType<typeof readPublicProducts>[number] | null;
