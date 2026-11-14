import fs from 'node:fs';
export const PRODUCT = Object.freeze(JSON.parse(fs.readFileSync(new URL('./product.json', import.meta.url), 'utf8')));
export const PRODUCT_NAME = PRODUCT.name;
export const PRODUCT_SLUG = PRODUCT.slug;
