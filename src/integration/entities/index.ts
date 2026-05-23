import { IntegrationOrigin } from '../../database/enums/integration-origin.enum';
import { A7PHARMA_ENTITIES } from './a7pharma';

export { A7PHARMA_ENTITIES } from './a7pharma';
export { NumericColumn, numericTransformer } from './numeric-column.decorator';

// TypeORM's DataSource `entities` accepts class constructors. Our entity
// arrays are arrays of decorated classes, so a Function[] alias models that
// without dragging in TypeORM's wider MixedList<Function | string | EntitySchema>.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type EntityList = ReadonlyArray<Function>;

// Per-tenant: each integration row carries an `origin`, and the entity set
// loaded into that tenant's DataSource is the one matching that origin.
// Adding a new vendor = new folder + new enum value + new row here.
const ENTITIES_BY_ORIGIN: Record<IntegrationOrigin, EntityList> = {
  [IntegrationOrigin.A7PHARMA]: A7PHARMA_ENTITIES,
};

export function entitiesForOrigin(origin: IntegrationOrigin): EntityList {
  return ENTITIES_BY_ORIGIN[origin];
}
