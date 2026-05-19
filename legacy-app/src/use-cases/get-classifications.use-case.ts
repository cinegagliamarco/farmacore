import { Injectable } from '@nestjs/common';
import { ClassificationRepository } from '../database/repositories/classification.repository';
import { GetClassificationsQueryParamDto } from '../dto/get-classifications-query-param.dto';

@Injectable()
export class GetClassificationsUseCase {
  constructor(private readonly classificationRepository: ClassificationRepository) {}

  public async execute(dto: GetClassificationsQueryParamDto): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const { page, perPage, name } = dto;
    const [results, count] = await this.classificationRepository.getClassificationsPaginated(page, perPage, name);

    const parsedList = results.map((classification) => ({
      id: classification.id,
      name: classification.name
    }));

    return { rows: parsedList, count };
  }
}
