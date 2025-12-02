import { shortTokenAddr } from "./utils";

let collectionSlug: string | undefined;

export const collectionStore = {
  getSlug: (): string | undefined => collectionSlug,
  setSlug: (slug: string): void => {
    collectionSlug = slug;
  },
  getIdentifier: (): string => collectionSlug ?? shortTokenAddr,
};
