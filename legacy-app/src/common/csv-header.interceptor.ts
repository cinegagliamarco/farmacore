import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class CsvHeaderInterceptor implements NestInterceptor {
  constructor(private readonly requiredHeaderFormat: string[][]) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const file = request.file; // Now the file exists

    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    // Convert file buffer to string and split into lines
    const fileContent = file.buffer.toString();
    const lines = fileContent.split(/\r?\n/);
    const csvHeader = lines[0]?.split(',');

    if (!csvHeader?.length) {
      throw new BadRequestException('CSV file is empty or missing headers');
    }

    // Check if headers match expected headers
    for (const headerFormat of this.requiredHeaderFormat) {
      if (this.areHeadersEqual(headerFormat, csvHeader)) {
        return next.handle();
      }
    }
    throw new BadRequestException(`Header format should be ${this.requiredHeaderFormat.join(' or ')}`);
  }

  private areHeadersEqual<T>(array1: T[], array2: T[]): boolean {
    if (array1.length !== array2.length) return false;
  
    for (let i = 0; i < array1.length; i++) {
      if (array1[i].toString().toLowerCase() !== array2[i].toString().toLowerCase()) return false;
    }
  
    return true;
  }
}
