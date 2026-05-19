import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { EXPORT_COLUMNS } from '../../common/constants/export-columns.constant';

@ValidatorConstraint({ name: 'isValidColumn', async: false })
export class IsValidColumn implements ValidatorConstraintInterface {
  private readonly validColumns = EXPORT_COLUMNS;

  validate(value: any, args: ValidationArguments) {
    if (typeof value !== 'string') {
      return false;
    }
    return this.validColumns.includes(value as any);
  }

  defaultMessage(args: ValidationArguments) {
    const validColumns = this.validColumns.join(', ');
    return `Invalid column: ${args.value}. Valid columns are: ${validColumns}`;
  }
}
