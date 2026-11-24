import product from './product.json' with { type: 'json' };
export const PRODUCT = Object.freeze(product);
export const PRODUCT_NAME = PRODUCT.name;
export const PRODUCT_SLUG = PRODUCT.slug;
