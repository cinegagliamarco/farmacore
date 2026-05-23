import { A7PHARMA_ENTITIES } from './a7pharma';

export { A7PHARMA_ENTITIES } from './a7pharma';
export { NumericColumn, numericTransformer } from './numeric-column.decorator';

// Union of all integration entity sets. v1 supports A7Pharma only;
// add other vendors here as their entity folders land.
export const INTEGRATION_ENTITIES = [...A7PHARMA_ENTITIES];
